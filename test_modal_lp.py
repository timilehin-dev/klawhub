import modal
app = modal.App("test-lp")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("lightpanda-py")
)

@app.function(image=image)
def test_lp():
    import lightpanda
    try:
        res = lightpanda.fetch("https://news.ycombinator.com", dump="markdown", wait_until="domcontentloaded", strip_mode="full")
        return res.text
    except Exception as e:
        return str(e)

if __name__ == "__main__":
    with app.run():
        print(test_lp.remote())
