# 🚀 Deployment Checklist - Launch TalentInsight

## Pre-Launch Checklist

### ✅ Supabase Setup
- [ ] Create Supabase project
- [ ] Run `supabase-schema.sql` in SQL Editor
- [ ] Create storage buckets (`candidate-cvs`, `company-logos`)
- [ ] Configure storage policies
- [ ] Test database connection
- [ ] Copy Project URL and anon key

### ✅ Google Cloud Setup
- [ ] Create Google Cloud project
- [ ] Enable Google Calendar API
- [ ] Create OAuth 2.0 credentials
- [ ] Add authorized redirect URIs (dev + prod)
- [ ] Configure OAuth consent screen
- [ ] Add required scopes
- [ ] Add test users (if not publishing)
- [ ] Copy Client ID and Secret

### ✅ Code Repository
- [ ] Initialize Git repository
- [ ] Create `.gitignore` (exclude `.env*`, `node_modules/`)
- [ ] Push to GitHub/GitLab
- [ ] Set repository to private (initially)

### ✅ Environment Variables
- [ ] Create `.env.local` for development
- [ ] Add all required variables (see `.env.example`)
- [ ] Test locally with `npm run dev`
- [ ] Prepare production env vars for Vercel

### ✅ Domain Setup
- [ ] Purchase domain (e.g., talentinsight.com)
- [ ] Access domain DNS settings
- [ ] Prepare for wildcard subdomain config

## Vercel Deployment Steps

### 1. Initial Deploy
```bash
# 1. Install Vercel CLI (optional)
npm i -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy
vercel

# OR use Vercel Dashboard:
# - Go to vercel.com
# - Click "New Project"
# - Import from GitHub
```

### 2. Configure Environment Variables

In Vercel Dashboard → Project → Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback
NEXT_PUBLIC_APP_URL=https://yourdomain.com
NEXT_PUBLIC_APP_NAME=TalentInsight
```

**Important**: Add variables for all environments (Production, Preview, Development)

### 3. Configure Custom Domain

In Vercel Dashboard → Project → Settings → Domains:

1. **Add root domain**:
   - Enter: `talentinsight.com`
   - Vercel provides DNS records

2. **Add wildcard subdomain**:
   - Enter: `*.talentinsight.com`
   - This enables multi-tenant subdomains

3. **Configure DNS** (at your domain provider):
   ```
   Type: A
   Name: @
   Value: 76.76.21.21
   
   Type: A  
   Name: *
   Value: 76.76.21.21
   
   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com
   ```

4. **Wait for DNS propagation** (up to 48 hours, usually faster)

### 4. Update Google OAuth

In Google Cloud Console → APIs & Services → Credentials:

1. Edit your OAuth 2.0 Client ID
2. Add production redirect URI:
   ```
   https://talentinsight.com/api/auth/google/callback
   https://*.talentinsight.com/api/auth/google/callback
   ```
3. Save changes

### 5. Test Production Deployment

- [ ] Visit your domain
- [ ] Test company registration
- [ ] Create a test subdomain
- [ ] Test candidate application flow
- [ ] Test assessment completion
- [ ] Test Google Calendar integration
- [ ] Test file uploads (CV)
- [ ] Check mobile responsiveness
- [ ] Test all user roles

## Post-Launch Setup

### ✅ Create Demo Company

```bash
# 1. Sign up at your domain
# 2. Create company: "Demo Corp"
# 3. Subdomain: "demo"
# 4. Add sample positions
# 5. Add sample candidates
# 6. Complete sample assessments
```

This gives you:
- Demo site: `demo.talentinsight.com`
- Example for sales/marketing
- Testing environment

### ✅ Set Up Monitoring

1. **Vercel Analytics**:
   - Enable in Vercel Dashboard
   - Track page views, performance

2. **Supabase Logs**:
   - Monitor database queries
   - Check for errors
   - Review API usage

3. **Error Tracking** (optional):
   - Add Sentry: `npm install @sentry/nextjs`
   - Configure error reporting

### ✅ Configure Email (Optional but Recommended)

For candidate notifications and team invites:

1. **Choose provider**: Resend, SendGrid, AWS SES
2. **Set up domain authentication**
3. **Add env vars**: `SMTP_*` variables
4. **Create email templates**
5. **Test emails**

### ✅ Security Hardening

- [ ] Enable Vercel DDoS protection
- [ ] Set up rate limiting (Upstash Redis)
- [ ] Review RLS policies in Supabase
- [ ] Enable Supabase Auth MFA (optional)
- [ ] Set up security headers in `next.config.js`

### ✅ Legal Pages

Create required pages:
- [ ] `/privacy` - Privacy Policy
- [ ] `/terms` - Terms of Service
- [ ] `/security` - Security practices
- [ ] `/gdpr` - GDPR compliance (if EU)

## Ongoing Maintenance

### Weekly
- [ ] Review error logs
- [ ] Check database performance
- [ ] Monitor API usage/costs

### Monthly
- [ ] Review user feedback
- [ ] Update dependencies: `npm update`
- [ ] Check security advisories
- [ ] Backup database (Supabase handles this)

### Quarterly
- [ ] Review pricing plans
- [ ] Analyze user metrics
- [ ] Plan new features
- [ ] Update documentation

## Scaling Checklist

When you reach 100+ companies:

- [ ] Upgrade Supabase plan
- [ ] Add Redis for caching
- [ ] Implement connection pooling
- [ ] Add CDN for static assets
- [ ] Consider database read replicas
- [ ] Implement job queue (for heavy operations)

## Marketing Launch

- [ ] Prepare launch post (LinkedIn, Twitter)
- [ ] Create Product Hunt submission
- [ ] Update company website
- [ ] Prepare demo video
- [ ] Create sales materials
- [ ] Set up analytics (Google Analytics, Mixpanel)
- [ ] Configure customer support (Intercom, Help Scout)

## Emergency Contacts

Keep these handy:
- **Vercel Support**: vercel.com/support
- **Supabase Support**: supabase.com/support  
- **Google Cloud Support**: cloud.google.com/support

## Rollback Plan

If something goes wrong:

1. **Vercel**: 
   - Go to Deployments
   - Find last working deployment
   - Click "Promote to Production"

2. **Database**:
   - Supabase has Point-in-Time Recovery
   - Contact support if needed

3. **DNS**:
   - Keep old DNS records documented
   - Can revert within minutes

## Success Metrics

Track these KPIs:
- [ ] Number of registered companies
- [ ] Number of active candidates
- [ ] Assessment completion rate
- [ ] Interview scheduling rate
- [ ] Customer churn rate
- [ ] Revenue (MRR/ARR)

---

## 🎉 Launch Day!

When everything is checked:

1. Make final deployment
2. Announce on social media
3. Email early access list
4. Monitor closely for first 24 hours
5. Celebrate! 🍾

---

**Questions?** Create an issue on GitHub or contact support.

Good luck with your launch! 🚀
