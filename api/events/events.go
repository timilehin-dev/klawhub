// NOTE: This file is compiled independently by Vercel as a serverless function.
// All files in this directory are part of the 'handler' package but are built
// in isolation by the @vercel/go builder. For local IDE compatibility and
// go mod tidy, duplicate helper functions (e.g. mathAbs, dispatchToInngest)
// are intentionally repeated in each entry point file so they are self-contained.
package handler

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type SlackChallenge struct {
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
	EventID   string `json:"event_id"`
}

func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// 1. Verify Slack request signature
	signingSecret := os.Getenv("SLACK_SIGNING_SECRET")
	if signingSecret == "" {
		http.Error(w, "Signing secret not configured", http.StatusInternalServerError)
		return
	}

	timestampStr := r.Header.Get("X-Slack-Request-Timestamp")
	slackSig := r.Header.Get("X-Slack-Signature")

	timestamp, err := strconv.ParseInt(timestampStr, 10, 64)
	if err != nil || mathAbs(time.Now().Unix()-timestamp) > 300 {
		http.Error(w, "Invalid timestamp or replay attack detected", http.StatusUnauthorized)
		return
	}

	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewBuffer(rawBody))

	sigBase := fmt.Sprintf("v0:%s:%s", timestampStr, string(rawBody))
	mac := hmac.New(sha256.New, []byte(signingSecret))
	mac.Write([]byte(sigBase))
	expectedSig := "v0:" + hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(slackSig), []byte(expectedSig)) {
		http.Error(w, "Invalid request signature", http.StatusUnauthorized)
		return
	}

	// 2. Parse basic details for URL challenge & Deduplication
	var slackReq SlackChallenge
	if err := json.Unmarshal(rawBody, &slackReq); err != nil {
		http.Error(w, "Failed to parse body", http.StatusBadRequest)
		return
	}

	// Handle Slack URL Verification Challenge
	if slackReq.Type == "url_verification" {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(slackReq.Challenge))
		return
	}

	// 3. Filter to only relevant event types — ignore non-message events
	var parsedBody map[string]interface{}
	if err := json.Unmarshal(rawBody, &parsedBody); err == nil {
		if innerEvent, ok := parsedBody["event"].(map[string]interface{}); ok {
			eventType, _ := innerEvent["type"].(string)
			// Only process message events. Ignore: reaction_added, file_shared,
			// member_joined_channel, app_mention (message already covers this), etc.
			if eventType != "message" {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("ignored"))
				return
			}
		}
	}

	// 4. Upstash Redis REST Deduplication
	redisURL := os.Getenv("UPSTASH_REDIS_REST_URL")
	redisToken := os.Getenv("UPSTASH_REDIS_REST_TOKEN")
	if redisURL != "" && redisToken != "" && slackReq.EventID != "" {
		isDuplicate, err := checkRedisDeduplication(redisURL, redisToken, slackReq.EventID)
		if err != nil {
			fmt.Printf("Redis deduplication error: %v\n", err)
		}
		if isDuplicate {
			// Slack event already processed, ACK and return
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("duplicate"))
			return
		}
	}

	// 4. Dispatch event to Inngest
	inngestKey := os.Getenv("INNGEST_EVENT_KEY")
	if inngestKey != "" {
		err := dispatchToInngest(inngestKey, "slack/event", rawBody)
		if err != nil {
			fmt.Printf("Failed to dispatch to Inngest: %v\n", err)
			http.Error(w, "Queue dispatch error", http.StatusInternalServerError)
			return
		}
	}

	// 5. ACK back to Slack
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func mathAbs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func checkRedisDeduplication(url, token, eventID string) (bool, error) {
	// Clean url trailing slash
	url = strings.TrimSuffix(url, "/")
	reqURL := fmt.Sprintf("%s/set/event:%s/1/NX/EX/3600", url, eventID)

	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err
	}

	// Upstash REST returns {"result": "OK"} if set successfully, or {"result": null} if key exists
	var res map[string]interface{}
	if err := json.Unmarshal(body, &res); err != nil {
		return false, err
	}

	result, exists := res["result"]
	if !exists || result == nil {
		// Key was not set, meaning it already exists (duplicate)
		return true, nil
	}

	return false, nil
}

func dispatchToInngest(key, eventName string, slackPayload []byte) error {
	inngestURL := "https://event.inngest.com/e/" + key

	// Unmarshal Slack payload to JSON so we can nest it properly under "data"
	var data interface{}
	if err := json.Unmarshal(slackPayload, &data); err != nil {
		return err
	}

	inngestPayload := map[string]interface{}{
		"name": eventName,
		"data": data,
	}

	payloadBytes, err := json.Marshal(inngestPayload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, inngestURL, bytes.NewBuffer(payloadBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("inngest returned status code %d", resp.StatusCode)
	}

	return nil
}
