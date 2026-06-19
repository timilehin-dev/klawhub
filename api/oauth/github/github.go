// GitHub OAuth 2.0 flow handler for KlawHub.
// Handles the GitHub OAuth callback, exchanges code for token,
// and dispatches to Inngest for encrypted storage.
package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	appURL := os.Getenv("NEXT_PUBLIC_APP_URL")
	if appURL == "" {
		appURL = "https://klawhub.xyz"
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	workspaceID := r.URL.Query().Get("state")
	clientID := os.Getenv("GITHUB_APP_CLIENT_ID")
	clientSecret := os.Getenv("GITHUB_APP_CLIENT_SECRET")

	if clientID == "" || clientSecret == "" {
		http.Error(w, "GitHub OAuth credentials not configured", http.StatusInternalServerError)
		return
	}

	// Exchange code for access token
	tokenResp, err := exchangeGitHubCode(code, clientID, clientSecret)
	if err != nil {
		http.Error(w, fmt.Sprintf("GitHub token exchange failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Get user email from GitHub API
	email := "unknown@github.com"
	if tokenResp.Token != "" {
		if userEmail, err := fetchGitHubEmail(tokenResp.Token); err == nil && userEmail != "" {
			email = userEmail
		}
	}

	// Dispatch to Inngest for encrypted storage
	inngestKey := os.Getenv("INNGEST_EVENT_KEY")
	if inngestKey != "" {
		tokenBytes, _ := json.Marshal(map[string]interface{}{
			"access_token": tokenResp.Token,
			"token_type":   "bearer",
			"scope":        "repo,user",
		})
		payload := map[string]interface{}{
			"name": "integration/authenticated",
			"data": map[string]interface{}{
				"workspace_id": workspaceID,
				"provider":     "github",
				"access_token": string(tokenBytes),
				"email":        email,
			},
		}
		payloadBytes, _ := json.Marshal(payload)
		_ = dispatchGitHubEvent(inngestKey, payloadBytes)
	}

	// Redirect to settings page (new flat path)
	http.Redirect(w, r, appURL+"/settings?github=connected", http.StatusFound)
}

func exchangeGitHubCode(code, clientID, clientSecret string) (*GitHubTokenResp, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)

	req, err := http.NewRequest(http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var tokenResp GitHubTokenResp
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, err
	}

	if tokenResp.Token == "" {
		if tokenResp.Error != "" {
			return nil, fmt.Errorf("GitHub error: %s - %s", tokenResp.Error, tokenResp.ErrorDescription)
		}
		return nil, fmt.Errorf("no access token returned")
	}

	return &tokenResp, nil
}

func fetchGitHubEmail(token string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var user map[string]interface{}
	if err := json.Unmarshal(body, &user); err != nil {
		return "", err
	}

	if email, ok := user["email"].(string); ok && email != "" {
		return email, nil
	}
	if login, ok := user["login"].(string); ok {
		return login + "@github.com", nil
	}
	return "", nil
}

func dispatchGitHubEvent(inngestKey string, payload []byte) error {
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

type GitHubTokenResp struct {
	Token           string `json:"access_token"`
	Error           string `json:"error"`
	ErrorDescription string `json:"error_description"`
}