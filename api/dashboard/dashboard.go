// Dashboard CRUD API for KlawHub.
//
// Security model:
// - Browser sends a Supabase user access token in Authorization: Bearer <jwt>.
// - Handler verifies the token against Supabase Auth before touching data.
// - Handler uses the service-role key server-side only and always adds a
//   workspace_id filter to preserve tenant isolation.
package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type supabaseUser struct {
	ID          string                 `json:"id"`
	Email       string                 `json:"email"`
	AppMetadata map[string]interface{} `json:"app_metadata"`
	UserMetadata map[string]interface{} `json:"user_metadata"`
}

var dashboardTables = map[string]string{
	"tasks":        "tasks",
	"schedules":    "schedules",
	"workflows":    "workflows",
	"skills":       "skills",
	"knowledge":    "knowledge",
	"usage":        "usage_logs",
	"settings":     "workspaces",
	"integrations": "integrations",
}

func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	supabaseURL := firstNonEmpty(os.Getenv("SUPABASE_URL"), os.Getenv("NEXT_PUBLIC_SUPABASE_URL"))
	serviceKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	anonKey := firstNonEmpty(os.Getenv("SUPABASE_ANON_KEY"), os.Getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY"))
	if supabaseURL == "" || serviceKey == "" || anonKey == "" {
		http.Error(w, "Supabase environment variables not configured", http.StatusInternalServerError)
		return
	}

	user, accessToken, err := verifySupabaseUser(r, supabaseURL, anonKey)
	if err != nil || accessToken == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		http.Error(w, "workspace_id query parameter is required", http.StatusBadRequest)
		return
	}

	if ok := authorizeWorkspace(supabaseURL, serviceKey, user, workspaceID); !ok {
		http.Error(w, "Forbidden for workspace", http.StatusForbidden)
		return
	}

	resource, id := parseDashboardPath(r.URL.Path)
	table, ok := dashboardTables[resource]
	if !ok {
		http.Error(w, "Unknown dashboard resource", http.StatusNotFound)
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleDashboardGet(w, r, supabaseURL, serviceKey, table, resource, id, workspaceID)
	case http.MethodPost:
		handleDashboardWrite(w, r, supabaseURL, serviceKey, table, resource, id, workspaceID, http.MethodPost)
	case http.MethodPatch, http.MethodPut:
		handleDashboardWrite(w, r, supabaseURL, serviceKey, table, resource, id, workspaceID, http.MethodPatch)
	case http.MethodDelete:
		handleDashboardDelete(w, r, supabaseURL, serviceKey, table, resource, id, workspaceID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func verifySupabaseUser(r *http.Request, supabaseURL, anonKey string) (*supabaseUser, string, error) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return nil, "", fmt.Errorf("missing bearer token")
	}
	token := strings.TrimPrefix(auth, "Bearer ")

	req, err := http.NewRequest(http.MethodGet, strings.TrimSuffix(supabaseURL, "/")+"/auth/v1/user", nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("apikey", anonKey)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("auth returned %d", resp.StatusCode)
	}

	var user supabaseUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, "", err
	}
	return &user, token, nil
}

func authorizeWorkspace(supabaseURL, serviceKey string, user *supabaseUser, workspaceID string) bool {
	if metadataString(user.UserMetadata, "workspace_id") == workspaceID || metadataString(user.AppMetadata, "workspace_id") == workspaceID {
		return true
	}

	slackUserID := metadataString(user.UserMetadata, "slack_user_id")
	if slackUserID == "" {
		return false
	}

	endpoint := strings.TrimSuffix(supabaseURL, "/") + "/rest/v1/workspace_members?select=workspace_id&limit=1" +
		"&workspace_id=eq." + url.QueryEscape(workspaceID) +
		"&slack_user_id=eq." + url.QueryEscape(slackUserID)

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return false
	}
	addServiceHeaders(req, serviceKey)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false
	}
	var rows []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return false
	}
	return len(rows) > 0
}

func handleDashboardGet(w http.ResponseWriter, r *http.Request, supabaseURL, serviceKey, table, resource, id, workspaceID string) {
	selectParam := r.URL.Query().Get("select")
	if selectParam == "" {
		selectParam = "*"
	}

	endpoint := strings.TrimSuffix(supabaseURL, "/") + "/rest/v1/" + table + "?select=" + url.QueryEscape(selectParam)
	endpoint += workspaceFilter(resource, workspaceID)
	if id != "" {
		endpoint += "&id=eq." + url.QueryEscape(id)
	}
	if order := defaultOrder(resource); order != "" && id == "" {
		endpoint += "&order=" + url.QueryEscape(order)
	}
	if limit := r.URL.Query().Get("limit"); limit != "" {
		endpoint += "&limit=" + url.QueryEscape(limit)
	}

	proxyJSON(w, http.MethodGet, endpoint, serviceKey, nil)
}

func handleDashboardWrite(w http.ResponseWriter, r *http.Request, supabaseURL, serviceKey, table, resource, id, workspaceID, method string) {
	body, err := readAndFilterBody(r, resource, method == http.MethodPost, workspaceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	endpoint := strings.TrimSuffix(supabaseURL, "/") + "/rest/v1/" + table
	if method == http.MethodPatch {
		if resource == "settings" {
			endpoint += "?id=eq." + url.QueryEscape(workspaceID)
		} else {
			if id == "" {
				http.Error(w, "id is required", http.StatusBadRequest)
				return
			}
			endpoint += "?id=eq." + url.QueryEscape(id) + workspaceFilter(resource, workspaceID)
		}
	}
	proxyJSON(w, method, endpoint, serviceKey, body)
}

func handleDashboardDelete(w http.ResponseWriter, r *http.Request, supabaseURL, serviceKey, table, resource, id, workspaceID string) {
	if id == "" && resource != "integrations" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}
	endpoint := strings.TrimSuffix(supabaseURL, "/") + "/rest/v1/" + table
	if resource == "integrations" && id == "" {
		provider := r.URL.Query().Get("provider")
		endpoint += "?workspace_id=eq." + url.QueryEscape(workspaceID)
		if provider != "" {
			endpoint += "&provider=eq." + url.QueryEscape(provider)
		}
	} else {
		endpoint += "?id=eq." + url.QueryEscape(id) + workspaceFilter(resource, workspaceID)
	}
	proxyJSON(w, http.MethodDelete, endpoint, serviceKey, nil)
}

func readAndFilterBody(r *http.Request, resource string, isInsert bool, workspaceID string) ([]byte, error) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	var incoming map[string]interface{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &incoming); err != nil {
			return nil, fmt.Errorf("invalid JSON body")
		}
	} else {
		incoming = map[string]interface{}{}
	}

	allowed := allowedFields(resource)
	filtered := map[string]interface{}{}
	for k, v := range incoming {
		if allowed[k] {
			filtered[k] = v
		}
	}
	if isInsert && resource != "settings" {
		filtered["workspace_id"] = workspaceID
	}
	if len(filtered) == 0 {
		return nil, fmt.Errorf("no valid fields supplied")
	}
	return json.Marshal(filtered)
}

func proxyJSON(w http.ResponseWriter, method, endpoint, serviceKey string, body []byte) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewBuffer(body)
	}
	req, err := http.NewRequest(method, endpoint, reader)
	if err != nil {
		http.Error(w, "failed to build upstream request", http.StatusInternalServerError)
		return
	}
	addServiceHeaders(req, serviceKey)
	if method == http.MethodPost || method == http.MethodPatch {
		req.Header.Set("Prefer", "return=representation")
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "upstream Supabase request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	out, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(out)
}

func addServiceHeaders(req *http.Request, serviceKey string) {
	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Content-Type", "application/json")
}

func parseDashboardPath(path string) (string, string) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/dashboard"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", ""
	}
	resource := parts[0]
	if len(parts) > 1 {
		return resource, parts[1]
	}
	return resource, ""
}

func workspaceFilter(resource, workspaceID string) string {
	if resource == "settings" {
		return "&id=eq." + url.QueryEscape(workspaceID)
	}
	return "&workspace_id=eq." + url.QueryEscape(workspaceID)
}

func allowedFields(resource string) map[string]bool {
	switch resource {
	case "tasks":
		return boolSet("title", "description", "status", "priority", "payload", "assignee_slack_id", "due_date", "due_at")
	case "schedules":
		return boolSet("name", "schedule_type", "cron_expr", "channel_id", "payload", "is_active", "next_run_at", "created_by")
	case "workflows":
		return boolSet("name", "description", "trigger_type", "trigger_config", "steps", "is_active", "created_by")
	case "settings":
		return boolSet("slack_team_name", "persona_name", "persona_prompt", "whitelisted_channels", "active_skills", "settings")
	case "skills":
		return boolSet("activation_status")
	case "knowledge":
		return boolSet("title", "content", "source_type", "source_url", "tags")
	default:
		return map[string]bool{}
	}
}

func defaultOrder(resource string) string {
	switch resource {
	case "tasks", "schedules", "workflows", "skills", "knowledge", "usage":
		return "created_at.desc"
	default:
		return ""
	}
}

func metadataString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func boolSet(keys ...string) map[string]bool {
	m := map[string]bool{}
	for _, k := range keys {
		m[k] = true
	}
	return m
}
