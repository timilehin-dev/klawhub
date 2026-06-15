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
	"net/url"
	"os"
	"strconv"
	"time"
)

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

	// 2. Parse slash command form parameters
	vals, err := url.ParseQuery(string(rawBody))
	if err != nil {
		http.Error(w, "Failed to parse query params", http.StatusBadRequest)
		return
	}

	commandPayload := map[string]string{
		"token":          vals.Get("token"),
		"team_id":        vals.Get("team_id"),
		"team_domain":    vals.Get("team_domain"),
		"channel_id":     vals.Get("channel_id"),
		"channel_name":   vals.Get("channel_name"),
		"user_id":        vals.Get("user_id"),
		"user_name":      vals.Get("user_name"),
		"command":        vals.Get("command"),
		"text":           vals.Get("text"),
		"response_url":   vals.Get("response_url"),
		"trigger_id":     vals.Get("trigger_id"),
		"api_app_id":     vals.Get("api_app_id"),
	}

	payloadBytes, err := json.Marshal(commandPayload)
	if err != nil {
		http.Error(w, "Failed to serialize payload", http.StatusInternalServerError)
		return
	}

	// 3. Dispatch to Inngest
	inngestKey := os.Getenv("INNGEST_EVENT_KEY")
	if inngestKey != "" {
		err := dispatchToInngest(inngestKey, "slack/command", payloadBytes)
		if err != nil {
			fmt.Printf("Failed to dispatch command to Inngest: %v\n", err)
			http.Error(w, "Queue dispatch error", http.StatusInternalServerError)
			return
		}
	}

	// 4. Respond to Slack
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("")) // Return empty string immediately as Go processes command asynchronously
}

func mathAbs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func dispatchToInngest(key, eventName string, slackPayload []byte) error {
	inngestURL := "https://event.inngest.com/e/" + key

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
