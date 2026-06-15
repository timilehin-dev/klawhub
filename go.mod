module github.com/timilehin-dev/klawhub

go 1.22

require (
	github.com/inngest/inngestgo v0.7.1
	github.com/redis/go-redis/v9 v9.5.1
	github.com/slack-go/slack v0.12.5
)

// NOTE: Run `go mod tidy` after first clone to generate go.sum
// and vendor dependencies before deploying to Vercel.
