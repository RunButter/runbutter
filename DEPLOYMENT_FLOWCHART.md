# 🎯 runbutter - DEPLOYMENT FLOWCHART

## COMPLETE LAUNCH PROCESS (30-45 Minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                        START HERE                               │
│                    Download Project Files                       │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 1: SUPABASE SETUP (10 min)                                │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Step 1.1: Create Project                                        │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Go to supabase.com                         │                │
│  │ • Click "New Project"                        │                │
│  │ • Name: runbutter                        │                │
│  │ • Choose region (closest to users)           │                │
│  │ • Set database password (SAVE THIS!)         │                │
│  │ • Wait 2-3 minutes                           │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 1.2: Run Schema                                            │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Go to SQL Editor                           │                │
│  │ • Click "+ New query"                        │                │
│  │ • Paste supabase-schema.sql                  │                │
│  │ • Click "Run"                                │                │
│  │ • ✓ Success message appears                  │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 1.3: Create Storage Buckets                                │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Go to Storage                              │                │
│  │ • Create "candidate-cvs" (Private)           │                │
│  │ • Create "company-logos" (Public)            │                │
│  │ • Set policies (see LAUNCH_GUIDE.md)         │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 1.4: Get Credentials                                       │
│  ┌──────────────────────────────────────────────┐                │
│  │ Settings → API                               │                │
│  │ ✓ Copy Project URL                           │                │
│  │ ✓ Copy anon public key                       │                │
│  └──────────────────────────────────────────────┘                │
│                                                                   │
└───────────────┬───────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 2: GOOGLE CLOUD SETUP (10 min)                            │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Step 2.1: Create Project                                        │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Go to console.cloud.google.com             │                │
│  │ • Click "New Project"                        │                │
│  │ • Name: runbutter                        │                │
│  │ • Wait ~30 seconds                           │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 2.2: Enable APIs                                           │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Enable "Google Calendar API"               │                │
│  │ • Enable "Google People API"                 │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 2.3: OAuth Consent                                         │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Select "External"                          │                │
│  │ • Fill app info                              │                │
│  │ • Add scopes (calendar.events)               │                │
│  │ • Add test users                             │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 2.4: Create Credentials                                    │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Create OAuth Client ID                     │                │
│  │ • Type: Web application                      │                │
│  │ • Redirect URI: localhost:3000/api/...       │                │
│  │ ✓ Copy Client ID                             │                │
│  │ ✓ Copy Client Secret                         │                │
│  └──────────────────────────────────────────────┘                │
│                                                                   │
└───────────────┬───────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 3: LOCAL TESTING (5 min)                                  │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Step 3.1: Install Dependencies                                  │
│  ┌──────────────────────────────────────────────┐                │
│  │ $ cd runbutter                          │                │
│  │ $ npm install                                │                │
│  │ (Wait 2-3 minutes)                           │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 3.2: Configure Environment                                 │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Copy .env.example to .env.local            │                │
│  │ • Add Supabase URL and key                   │                │
│  │ • Add Google Client ID and Secret            │                │
│  │ • Set app URL to localhost:3000              │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 3.3: Start Dev Server                                      │
│  ┌──────────────────────────────────────────────┐                │
│  │ $ npm run dev                                │                │
│  │ ✓ Server runs on localhost:3000              │                │
│  │ ✓ Test registration                          │                │
│  │ ✓ Test login                                 │                │
│  └──────────────────────────────────────────────┘                │
│                                                                   │
└───────────────┬───────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 4: VERCEL DEPLOYMENT (15 min)                             │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Step 4.1: Push to GitHub                                        │
│  ┌──────────────────────────────────────────────┐                │
│  │ $ git init                                   │                │
│  │ $ git add .                                  │                │
│  │ $ git commit -m "Initial"                    │                │
│  │ $ git push origin main                       │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 4.2: Deploy on Vercel                                      │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Go to vercel.com                           │                │
│  │ • Import GitHub repo                         │                │
│  │ • Add ALL environment variables              │                │
│  │ • Click "Deploy"                             │                │
│  │ • Wait 2-3 minutes                           │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 4.3: Test Production                                       │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Visit your-app.vercel.app                  │                │
│  │ ✓ Test registration                          │                │
│  │ ✓ Create company                             │                │
│  │ ✓ Create position                            │                │
│  │ ✓ Test candidate application                 │                │
│  └──────────────────────────────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│  Step 4.4: Custom Domain (OPTIONAL)                              │
│  ┌──────────────────────────────────────────────┐                │
│  │ • Add domain in Vercel                       │                │
│  │ • Configure DNS (A records)                  │                │
│  │ • Update Google OAuth redirect               │                │
│  │ • Wait for DNS propagation (24-48h)          │                │
│  └──────────────────────────────────────────────┘                │
│                                                                   │
└───────────────┬───────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│                    🎉 LAUNCH SUCCESS! 🎉                          │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Your SaaS is now LIVE and ready for users!                      │
│                                                                   │
│  ✓ Multi-tenant platform running                                 │
│  ✓ Database connected and secured                                │
│  ✓ Authentication working                                        │
│  ✓ File uploads functional                                       │
│  ✓ Google Calendar integrated                                    │
│  ✓ Ready for real users                                          │
│                                                                   │
│  Next Steps:                                                      │
│  1. Create demo company and positions                            │
│  2. Add test candidates                                          │
│  3. Share with early users                                       │
│  4. Collect feedback                                             │
│  5. Iterate and improve                                          │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## TROUBLESHOOTING DECISION TREE

```
Problem? 
    │
    ├─ Database connection failed
    │   └─→ Check SUPABASE_URL is correct
    │       └─→ Verify anon key is correct
    │           └─→ Ensure schema was run successfully
    │
    ├─ Authentication not working
    │   └─→ Check Supabase Auth is enabled
    │       └─→ Verify RLS policies exist
    │           └─→ Test with simple user creation
    │
    ├─ Google OAuth failing
    │   └─→ Check redirect URI matches EXACTLY
    │       └─→ Verify APIs are enabled
    │           └─→ Check credentials are correct
    │               └─→ Add test users if needed
    │
    ├─ File uploads not working
    │   └─→ Check storage buckets exist
    │       └─→ Verify storage policies are set
    │           └─→ Test with small file first
    │               └─→ Check file size limits
    │
    └─ Subdomain not loading
        └─→ Check DNS propagation (48h max)
            └─→ Verify wildcard A record exists
                └─→ Confirm domain in Vercel
                    └─→ Test with specific subdomain
```

---

## ENVIRONMENT VARIABLES CHECKLIST

```
Required Variables:
┌─────────────────────────────────────────────┐
│ NEXT_PUBLIC_SUPABASE_URL                    │ ← From Supabase Settings → API
│ NEXT_PUBLIC_SUPABASE_ANON_KEY               │ ← From Supabase Settings → API
│ GOOGLE_CLIENT_ID                            │ ← From Google Cloud Console
│ GOOGLE_CLIENT_SECRET                        │ ← From Google Cloud Console
│ GOOGLE_REDIRECT_URI                         │ ← Your domain + /api/auth/google/callback
│ NEXT_PUBLIC_APP_URL                         │ ← Your Vercel URL or custom domain
│ NEXT_PUBLIC_APP_NAME                        │ ← runbutter (or your name)
└─────────────────────────────────────────────┘
```

---

## QUICK START COMMANDS

```bash
# 1. Install
cd runbutter
npm install

# 2. Configure
cp .env.example .env.local
# Edit .env.local with your credentials

# 3. Develop
npm run dev

# 4. Deploy
git init
git add .
git commit -m "Initial commit"
git push origin main
# Then deploy on Vercel

# 5. Monitor
vercel logs
```

---

## SUCCESS METRICS

### Week 1:
- [ ] 5+ company registrations
- [ ] 10+ candidate applications
- [ ] 5+ assessments completed
- [ ] 1+ interview scheduled

### Month 1:
- [ ] 50+ companies
- [ ] 25+ paid conversions
- [ ] $2,500 MRR
- [ ] <5% churn

---

Ready to launch? Follow the flowchart step by step!
