# MPM test site — put it online (GitHub + Render)

This runs the existing prototype as an always-on web service you can reach from any computer.
It is a private test site. It does not enable live SMS, notices, or mailing. Use fake data only.

## What protects it
The whole site sits behind one password. You set that password in Render as an environment
variable named `SITE_PASSWORD`. The password is never stored in the code or on GitHub. When
`SITE_PASSWORD` is not set (your laptop, the tests), the site is open, which is expected.

## Part 1 — Put the code on GitHub (browser only)
1. Go to github.com and create a new repository. Name it `mpm-prototype`. Keep it Private.
2. On the new repo page, click "uploading an existing file".
3. Open the folder I gave you, select ALL of its contents (not the folder itself), and drag
   them into the browser. Confirm you see `package.json`, the `src`, `public`, and `test`
   folders, `.gitignore`, `.node-version`, `README.md`, and `DEPLOY.md`.
4. Click "Commit changes".

## Part 2 — Run it on Render
1. Go to render.com, then New, then Web Service. Connect the `mpm-prototype` repository.
2. Settings:
   - Runtime / Language: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
   - Leave Root Directory blank (package.json is at the repo root).
3. Add an environment variable:
   - Key: `SITE_PASSWORD`
   - Value: a password you choose (write it down)
4. Click Create Web Service. Wait for the build to finish (a few minutes).
5. Open the URL Render gives you. Your browser will ask for a username and password.
   - Username: anything (for example `mpm`)
   - Password: the value you set for `SITE_PASSWORD`

## Editing wording later
Change the files under `public/` on GitHub (edit in the browser, or with GitHub Desktop later).
Render redeploys automatically on each change. Refresh the site to see it.

## Known limits of the free tier (expected)
- The service sleeps when idle. The first visit after a pause can take 20 to 30 seconds to wake.
- Data does not persist. Each deploy or wake starts with an empty database. Fine for testing copy
  and flow with fake data. Not suitable for real records.

## Before any real pilot (not now)
- Remove the developer controls (the "Prototype simulation controls" panel and the `/api/dev/*`
  routes). The password protects them today, but they must be gone before real users.
- Decide data retention, privacy, and the counsel gates (TCPA, state notice content, retention/EXIF,
  referral monetization, defensible-file copy) before any real tenant data or live channel.
