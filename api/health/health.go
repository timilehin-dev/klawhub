// NOTE: This file is compiled independently by Vercel as a serverless function.
// All files in this directory are part of the 'handler' package but are built
// in isolation by the @vercel/go builder. For local IDE compatibility and
// go mod tidy, duplicate helper functions are intentionally repeated in each
// entry point file so they are self-contained.
package handler

import (
	"encoding/json"
	"net/http"
	"time"
)

type HealthResponse struct {
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
	Version   string    `json:"version"`
}

func HealthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	res := HealthResponse{
		Status:    "OK",
		Timestamp: time.Now(),
		Version:   "2.0.0",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(res)
}

// Handler is the Vercel entrypoint
func Handler(w http.ResponseWriter, r *http.Request) {
	HealthHandler(w, r)
}
