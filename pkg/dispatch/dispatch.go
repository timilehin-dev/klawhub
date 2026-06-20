// Package dispatch provides shared utility functions for dispatching events
// to Inngest from Go serverless handlers. All three Slack handler files
// (events, actions, commands) use this package instead of duplicating the
// dispatchToInngest and mathAbs functions.
package dispatch

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// DispatchToInngest sends an event to the Inngest event API.
// key is the INNGEST_EVENT_KEY, eventName is the Inngest event name
// (e.g. "slack/event", "slack/action", "slack/command"), and
// slackPayload is the raw JSON payload from Slack.
func DispatchToInngest(key, eventName string, slackPayload []byte) error {
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
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("inngest returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// MathAbs returns the absolute value of x.
func MathAbs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}
