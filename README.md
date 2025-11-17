# ScraperX Railway Deployment

## 🚀 One-click Deployment Instructions

1. Create a GitHub repo named **scraperx**.
2. Upload all files from this ZIP into that repo.
3. Go to **Railway.app → New Project → Deploy from GitHub**.
4. Select your `scraperx` repo.
5. In Railway → **Variables**, add:
   - `OPENAI_API_KEY = sk-xxxx`
6. Deploy.
7. Your endpoint will be:
   ```
   https://<project>.up.railway.app/enrich
   ```

Use that endpoint inside the ScraperX Chrome extension popup.
