// NOTE: This file is compiled independently by Vercel as a serverless function.
// All files in this directory are part of the 'handler' package but are built
// in isolation by the @vercel/go builder. For local IDE compatibility and
// go mod tidy, duplicate helper functions are intentionally repeated in each
// entry point file so they are self-contained.
package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// SlackOAuthResponse is the response from Slack's oauth.v2.access endpoint
type SlackOAuthResponse struct {
	OK          bool   `json:"ok"`
	Error       string `json:"error"`
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
	BotUserID   string `json:"bot_user_id"`
	AppID       string `json:"app_id"`
	Team        struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"team"`
	AuthedUser struct {
		ID          string `json:"id"`
		Scope       string `json:"scope"`
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	} `json:"authed_user"`
}

// Handler handles GET /api/oauth — the Slack OAuth2 installation callback.
// Slack redirects here with `?code=xxx` after the user clicks "Add to Slack".
// We exchange the code for a bot token and register the workspace in Supabase
// via the Inngest `workspace/install` event.
func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		// User denied the installation
		errorReason := r.URL.Query().Get("error")
		appURL := os.Getenv("NEXT_PUBLIC_APP_URL")
		http.Redirect(w, r, appURL+"?install=denied&reason="+errorReason, http.StatusFound)
		return
	}

	clientID := os.Getenv("SLACK_CLIENT_ID")
	clientSecret := os.Getenv("SLACK_CLIENT_SECRET")
	appURL := os.Getenv("NEXT_PUBLIC_APP_URL")

	if clientID == "" || clientSecret == "" {
		http.Error(w, "Slack OAuth credentials not configured", http.StatusInternalServerError)
		return
	}

	// Exchange code for access token
	oauthResp, err := exchangeSlackCode(code, clientID, clientSecret, appURL+"/api/oauth")
	if err != nil {
		http.Error(w, fmt.Sprintf("OAuth token exchange failed: %v", err), http.StatusInternalServerError)
		return
	}

	if !oauthResp.OK {
		http.Error(w, fmt.Sprintf("Slack returned error: %s", oauthResp.Error), http.StatusBadRequest)
		return
	}

	// Dispatch workspace installation event to Inngest
	// The Python worker will encrypt the bot token and upsert the workspace row
	inngestKey := os.Getenv("INNGEST_EVENT_KEY")
	if inngestKey != "" {
		payload := map[string]interface{}{
			"name": "workspace/install",
			"data": map[string]interface{}{
				"slack_team_id":   oauthResp.Team.ID,
				"slack_team_name": oauthResp.Team.Name,
				"bot_token":       oauthResp.AccessToken,
				"bot_user_id":     oauthResp.BotUserID,
				"authed_user_id":  oauthResp.AuthedUser.ID,
			},
		}
		payloadBytes, _ := json.Marshal(payload)
		if dispatchErr := dispatchOAuthEvent(inngestKey, payloadBytes); dispatchErr != nil {
			fmt.Printf("Failed to dispatch workspace/install event: %v\n", dispatchErr)
		}
	}

	// Redirect to the dashboard with success message
	http.Redirect(w, r, appURL+"/dashboard?install=success&team="+oauthResp.Team.Name, http.StatusFound)
}

func exchangeSlackCode(code, clientID, clientSecret, redirectURI string) (*SlackOAuthResponse, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("redirect_uri", redirectURI)

	req, err := http.NewRequest(http.MethodPost, "https://slack.com/api/oauth.v2.access", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var oauthResp SlackOAuthResponse
	if err := json.Unmarshal(body, &oauthResp); err != nil {
		return nil, err
	}
	return &oauthResp, nil
}

func dispatchOAuthEvent(inngestKey string, payload []byte) error {
	req, err := http.NewRequest(http.MethodPost, "https://event.inngest.com/e/"+inngestKey, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("inngest returned %d", resp.StatusCode)
	}
	return nil
}
