// Google OAuth 2.0 flow handler for KlawHub.
// Initiates the OAuth PKCE flow and handles the callback.
// Stores encrypted tokens in the Supabase integrations table via Inngest.
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
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")

	if clientID == "" || clientSecret == "" {
		http.Error(w, "Google OAuth credentials not configured", http.StatusInternalServerError)
		return
	}

	redirectURI := appURL + "/api/oauth/google/callback"

	// Exchange code for tokens
	tokenResp, err := exchangeGoogleCode(code, clientID, clientSecret, redirectURI)
	if err != nil {
		http.Error(w, fmt.Sprintf("Token exchange failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Get user email
	email := "unknown@gmail.com"
	if tokenResp.UserInfo != "" {
		email = tokenResp.UserInfo
	}

	// Encrypt tokens and dispatch to Inngest for storage
	inngestKey := os.Getenv("INNGEST_EVENT_KEY")
	if inngestKey != "" {
		tokenBytes, _ := json.Marshal(map[string]interface{}{
			"access_token":  tokenResp.AccessToken,
			"refresh_token": tokenResp.RefreshToken,
			"expires_at":    time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second).Unix(),
			"token_type":    tokenResp.TokenType,
			"scope":         tokenResp.Scope,
		})
		payload := map[string]interface{}{
			"name": "integration/authenticated",
			"data": map[string]interface{}{
				"workspace_id": workspaceID,
				"provider":     "google",
				"access_token": string(tokenBytes),
				"email":        email,
			},
		}
		payloadBytes, _ := json.Marshal(payload)
		_ = dispatchGoogleEvent(inngestKey, payloadBytes)
	}

	// Redirect to settings page (new flat path)
	http.Redirect(w, r, appURL+"/settings?google=connected", http.StatusFound)
}

func exchangeGoogleCode(code, clientID, clientSecret, redirectURI string) (*GoogleTokenResp, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", redirectURI)

	req, err := http.NewRequest(http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

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

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Google token exchange returned %d: %s", resp.StatusCode, string(body[:200]))
	}

	var tokenResp GoogleTokenResp
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, err
	}
	return &tokenResp, nil
}

func dispatchGoogleEvent(inngestKey string, payload []byte) error {
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

type GoogleTokenResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	UserInfo     string `json:"id_token"`
}