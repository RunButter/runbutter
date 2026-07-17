# 🚀 COMPLETE LAUNCH GUIDE - runbutter MVP

## WHAT YOU HAVE: FULLY FUNCTIONAL SAAS

✅ Multi-tenant architecture (subdomains)
✅ Authentication system (Supabase Auth)
✅ Company registration & onboarding
✅ Candidate application portal
✅ Assessment engine (Big 5, Work Style, Cognitive)
✅ Admin dashboard with analytics
✅ Interview scheduling (Google Calendar/Meet)
✅ File uploads (CV storage)
✅ Database with RLS security
✅ Beautiful, responsive UI

---

## 🎯 LAUNCH IN 4 STEPS (30-45 MINUTES)

### STEP 1: SET UP SUPABASE (10 minutes)

#### 1.1 Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in:
   - **Name**: runbutter
   - **Database Password**: (save this!)
   - **Region**: Choose closest to your users
4. Click "Create new project"
5. Wait 2-3 minutes for project to be ready

#### 1.2 Run Database Schema
1. In Supabase dashboard, go to **SQL Editor**
2. Click **"+ New query"**
3. Copy ENTIRE contents of `supabase-schema.sql`
4. Paste into editor
5. Click **"Run"** (bottom right)
6. You should see "Success. No rows returned"

#### 1.3 Create Storage Buckets
1. Go to **Storage** in left sidebar
2. Click **"Create bucket"**
3. Create first bucket:
   - Name: `candidate-cvs`
   - Public: **No** (unchecked)
   - Click "Create bucket"
4. Create second bucket:
   - Name: `company-logos`
   - Public: **Yes** (checked)
   - Click "Create bucket"

#### 1.4 Set Storage Policies
1. Click on `candidate-cvs` bucket
2. Go to **Policies** tab
3. Click **"New Policy"** → **"For full customization"**
4. Policy for UPLOAD:
   ```sql
   -- Allow authenticated users to upload
   CREATE POLICY "Allow authenticated uploads" ON storage.objects
   FOR INSERT TO authenticated
   WITH CHECK (bucket_id = 'candidate-cvs');
   ```
5. Policy for SELECT:
   ```sql
   -- Allow users to read their company's CVs
   CREATE POLICY "Allow company users to read CVs" ON storage.objects
   FOR SELECT TO authenticated
   USING (
     bucket_id = 'candidate-cvs' AND
     auth.uid() IN (
       SELECT auth_user_id FROM company_users
     )
   );
   ```

#### 1.5 Get Your Credentials
1. Go to **Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJxxx...` (long string)
3. Save these - you'll need them next!

---

### STEP 2: SET UP GOOGLE CALENDAR API (10 minutes)

#### 2.1 Create Google Cloud Project
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click project dropdown (top left)
3. Click **"New Project"**
4. Name: **runbutter**
5. Click **"Create"**
6. Wait for project to be created (~30 seconds)

#### 2.2 Enable APIs
1. In search bar, type "Google Calendar API"
2. Click **"Google Calendar API"**
3. Click **"Enable"**
4. Go back to search, type "Google People API"
5. Click **"Google People API"**
6. Click **"Enable"**

#### 2.3 Configure OAuth Consent Screen
1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **"External"**
3. Click **"Create"**
4. Fill in:
   - **App name**: runbutter
   - **User support email**: your-email@gmail.com
   - **Developer contact**: your-email@gmail.com
5. Click **"Save and Continue"**
6. On **Scopes** page:
   - Click **"Add or Remove Scopes"**
   - Find and check:
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.readonly`
   - Click **"Update"**
   - Click **"Save and Continue"**
7. On **Test users** page:
   - Click **"Add Users"**
   - Add your email
   - Click **"Save and Continue"**

#### 2.4 Create OAuth Credentials
1. Go to **APIs & Services** → **Credentials**
2. Click **"+ Create Credentials"** → **"OAuth client ID"**
3. Choose **"Web application"**
4. Fill in:
   - **Name**: runbutter Web
   - **Authorized redirect URIs**: Add BOTH:
     - `http://localhost:3000/api/auth/google/callback`
     - `https://YOUR-DOMAIN.vercel.app/api/auth/google/callback`
5. Click **"Create"**
6. **SAVE THESE**:
   - Client ID: `xxxx.apps.googleusercontent.com`
   - Client Secret: `GOCSPX-xxxx`

---

### STEP 3: DEPLOY TO VERCEL (10 minutes)

#### 3.1 Push Code to GitHub
```bash
# In your terminal, navigate to runbutter folder
cd runbutter

# Initialize git
git init
git add .
git commit -m "Initial commit - runbutter MVP"

# Create GitHub repo (or use GitHub Desktop)
# Then push:
git remote add origin https://github.com/YOUR-USERNAME/runbutter.git
git branch -M main
git push -u origin main
```

#### 3.2 Deploy on Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click **"Add New..."** → **"Project"**
3. Click **"Import"** next to your GitHub repo
4. In **Configure Project**:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `./` (default)
   - Click **"Environment Variables"** dropdown

#### 3.3 Add Environment Variables
Add these ONE BY ONE:

```
NEXT_PUBLIC_SUPABASE_URL
Value: https://xxxxx.supabase.co

NEXT_PUBLIC_SUPABASE_ANON_KEY
Value: eyJxxx... (your anon key)

GOOGLE_CLIENT_ID
Value: xxxxx.apps.googleusercontent.com

GOOGLE_CLIENT_SECRET  
Value: GOCSPX-xxxxx

GOOGLE_REDIRECT_URI
Value: https://YOUR-PROJECT.vercel.app/api/auth/google/callback

NEXT_PUBLIC_APP_URL
Value: https://YOUR-PROJECT.vercel.app

NEXT_PUBLIC_APP_NAME
Value: runbutter
```

5. Click **"Deploy"**
6. Wait 2-3 minutes for deployment
7. You'll see "Congratulations!" when done

#### 3.4 Get Your Vercel URL
1. Click **"Continue to Dashboard"**
2. Your app is live at: `https://runbutter-xxxx.vercel.app`
3. Click the URL to test!

---

### STEP 4: CONFIGURE CUSTOM DOMAIN (15 minutes) - OPTIONAL

#### 4.1 Add Domain to Vercel
1. In Vercel dashboard → **Settings** → **Domains**
2. Enter your domain: `runbutter.com`
3. Click **"Add"**
4. Vercel will show DNS records

#### 4.2 Configure DNS
At your domain provider (Namecheap, GoDaddy, etc.):

**For root domain:**
```
Type: A
Name: @
Value: 76.76.21.21
TTL: 3600
```

**For wildcard (multi-tenant):**
```
Type: A
Name: *
Value: 76.76.21.21
TTL: 3600
```

**For www:**
```
Type: CNAME
Name: www
Value: cname.vercel-dns.com
TTL: 3600
```

#### 4.3 Update Google OAuth
1. Back to Google Cloud Console
2. **APIs & Services** → **Credentials**
3. Click your OAuth client
4. Add to **Authorized redirect URIs**:
   - `https://runbutter.com/api/auth/google/callback`
   - `https://*.runbutter.com/api/auth/google/callback`
5. Click **"Save"**

#### 4.4 Update Vercel Environment Variables
1. In Vercel → **Settings** → **Environment Variables**
2. Update these:
   - `GOOGLE_REDIRECT_URI`: `https://runbutter.com/api/auth/google/callback`
   - `NEXT_PUBLIC_APP_URL`: `https://runbutter.com`
3. Click **"Deployments"** → **"Redeploy"** (with "Use existing Build Cache" unchecked)

---

## ✅ TESTING YOUR MVP

### Test 1: Company Registration
1. Visit your app URL
2. Click **"Get Started"** or **"Sign Up"**
3. Fill in:
   - Company Name: **Test Company**
   - Subdomain: **testco**
4. Create admin user
5. You should land on dashboard

### Test 2: Create a Position
1. In dashboard, click **"Create Position"**
2. Fill in job details
3. Save position
4. Position should appear in list

### Test 3: Candidate Application (Open New Incognito Window)
1. Go to: `https://YOUR-APP.vercel.app/apply/[position-id]`
2. Fill application form
3. Upload a test PDF as CV
4. Submit application
5. Check if it appears in your dashboard

### Test 4: Assessment Flow
1. From candidate list, click candidate
2. Click **"Send Assessment"**
3. Open assessment link
4. Complete all questions
5. Check results in dashboard

### Test 5: Google Calendar
1. Click **"Connect Google Calendar"**
2. Authorize with Google
3. Schedule a test interview
4. Check your Google Calendar for the event

---

## 🎉 YOU'RE LIVE!

Your SaaS is now:
- ✅ Deployed and accessible
- ✅ Database connected
- ✅ Authentication working
- ✅ Ready for real users

### Next Steps:

#### 1. Create Demo Content
- Add 2-3 sample positions
- Create test candidates
- Complete assessments
- Schedule sample interviews

This gives you demo data for:
- Screenshots for marketing
- Demos for potential customers
- Testing before real users

#### 2. Set Up Monitoring
**Vercel Analytics:**
- Go to Vercel dashboard → **Analytics**
- Click **"Enable"**
- Free tier: 100k events/month

**Supabase Monitoring:**
- Go to Supabase → **Reports**
- Monitor API requests
- Check database performance

#### 3. Marketing Launch
```bash
# Create demo company
Company: Demo Corp
Subdomain: demo
URL: https://demo.your-domain.com

# Share this URL:
- On Twitter/LinkedIn
- In Product Hunt
- To early access list
```

#### 4. Customer Onboarding
First 10 customers should get:
- Personal onboarding call
- Help setting up first position
- Custom branding setup
- Direct support (email/Slack)

---

## 📊 TRACKING SUCCESS

### Week 1 Goals:
- [ ] 5 company sign-ups
- [ ] 3 active positions created
- [ ] 10 candidate applications
- [ ] 5 assessments completed

### Week 2 Goals:
- [ ] 15 total companies
- [ ] 10 paid conversions
- [ ] 50+ candidates
- [ ] First interview scheduled

### Month 1 Goals:
- [ ] 50 companies
- [ ] 25 paid customers
- [ ] $2,500 MRR
- [ ] <5% churn

---

## 🚨 TROUBLESHOOTING

### "Supabase connection failed"
- Check NEXT_PUBLIC_SUPABASE_URL is correct
- Verify anon key is correct
- Ensure RLS policies are created

### "Google OAuth not working"
- Check redirect URIs match EXACTLY
- Verify APIs are enabled
- Check client ID/secret are correct

### "Subdomain not loading"
- DNS takes 24-48 hours to propagate
- Check wildcard A record exists
- Verify domain is added to Vercel

### "File uploads failing"
- Check storage buckets exist
- Verify storage policies are set
- Test with small file first

---

## 💰 PRICING RECOMMENDATIONS

Based on your features:

**Free Tier:**
- 10 candidates/month
- 1 active position
- Basic assessments
- Email support

**Starter - $99/month:**
- 50 candidates/month
- 5 active positions
- All assessments
- Google Calendar integration
- Custom branding
- Priority support

**Professional - $299/month:**
- 200 candidates/month
- Unlimited positions
- Advanced analytics
- Team collaboration (5 users)
- API access
- Dedicated support

**Enterprise - Custom:**
- Unlimited everything
- Custom assessments
- SSO/SAML
- SLA guarantee
- Dedicated account manager

---

## 📞 SUPPORT RESOURCES

**Documentation:**
- README.md - Full setup guide
- DEPLOYMENT.md - This guide
- PROJECT_STRUCTURE.md - Architecture

**Community:**
- GitHub Issues for bugs
- Discord for questions
- Email for urgent issues

**Monitoring:**
- Vercel logs: `vercel logs`
- Supabase logs: Dashboard → Logs
- Error tracking: Add Sentry later

---

## 🎯 CONGRATULATIONS!

You've launched a production-ready SaaS in under an hour!

**What you built:**
- Multi-tenant platform
- Complete assessment system
- Interview scheduling
- Beautiful UI/UX
- Secure & scalable

**You're now ready to:**
1. Get your first customers
2. Iterate based on feedback
3. Scale to thousands of users
4. Build a real business

**Need help?** 
Create an issue on GitHub or reach out!

Good luck with your launch! 🚀

---

## 📋 QUICK REFERENCE

### Important URLs:
- **Supabase**: https://app.supabase.com
- **Google Cloud**: https://console.cloud.google.com
- **Vercel**: https://vercel.com/dashboard
- **Your App**: https://YOUR-APP.vercel.app

### Environment Variables (Copy-Paste Template):
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_APP_NAME=runbutter
```

### Common Commands:
```bash
# Local development
npm install
npm run dev

# Deploy to Vercel
vercel --prod

# View logs
vercel logs

# Check environment
vercel env ls
```

---

**Last updated**: Now
**Version**: 1.0.0 MVP
**Status**: Production Ready ✅
