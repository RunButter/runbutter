# TalentInsight - AI-Powered Recruitment Assessment SaaS

A full-stack, multi-tenant SaaS platform for evaluating job candidates through personality tests, work style analysis, and cognitive assessments. Built with Next.js, Supabase, and Google Calendar integration.

## 🚀 Features

- **Multi-Tenant Architecture**: Each company gets their own subdomain
- **Comprehensive Assessments**: 
  - Big 5 Personality Tests
  - Work Style Preferences
  - Cognitive Problem-Solving
- **Candidate Portal**: Beautiful application flow with CV upload
- **Admin Dashboard**: Results visualization, analytics, and insights
- **Interview Scheduling**: Google Calendar & Meet integration
- **Role-Based Access**: Owner, Admin, Recruiter, Viewer roles
- **Real-time Updates**: Live status tracking for candidates

## 📋 Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage (CVs, logos)
- **Integrations**: Google Calendar API, Google Meet
- **Hosting**: Vercel
- **Charts**: Chart.js

## 🛠️ Setup Guide

### 1. Prerequisites

- Node.js 18+ installed
- Supabase account
- Google Cloud Console account (for Calendar API)
- Vercel account (for deployment)

### 2. Supabase Setup

1. **Create a new Supabase project** at [supabase.com](https://supabase.com)

2. **Run the database schema**:
   - Go to SQL Editor in Supabase dashboard
   - Copy and paste the contents of `supabase-schema.sql`
   - Click "Run"

3. **Create Storage Buckets**:
   ```sql
   -- Run in Supabase SQL Editor
   INSERT INTO storage.buckets (id, name, public) 
   VALUES ('candidate-cvs', 'candidate-cvs', false);
   
   INSERT INTO storage.buckets (id, name, public) 
   VALUES ('company-logos', 'company-logos', true);
   ```

4. **Set Storage Policies**:
   - Go to Storage > Policies
   - For `candidate-cvs`: Allow authenticated users to upload
   - For `company-logos`: Allow public read, authenticated write

5. **Get your credentials**:
   - Go to Settings > API
   - Copy `Project URL` and `anon public` key

### 3. Google Calendar Setup

1. **Go to [Google Cloud Console](https://console.cloud.google.com)**

2. **Create a new project** (or use existing)

3. **Enable APIs**:
   - Go to "APIs & Services" > "Library"
   - Enable "Google Calendar API"
   - Enable "Google Meet API" (if available)

4. **Create OAuth 2.0 Credentials**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: "Web application"
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback` (development)
     - `https://your-domain.vercel.app/api/auth/google/callback` (production)
   - Copy Client ID and Client Secret

5. **Configure OAuth Consent Screen**:
   - Add scopes: `calendar.events`, `calendar.readonly`
   - Add test users if not published

### 4. Local Development Setup

1. **Clone and install**:
   ```bash
   git clone <your-repo>
   cd talent-insight
   npm install
   ```

2. **Create `.env.local`**:
   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   
   # Google OAuth
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   
   # App Config
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NEXT_PUBLIC_APP_NAME=TalentInsight
   ```

3. **Run development server**:
   ```bash
   npm run dev
   ```
   
   Open [http://localhost:3000](http://localhost:3000)

### 5. Deploy to Vercel

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Deploy on Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Add environment variables (same as `.env.local`)
   - Click "Deploy"

3. **Configure Custom Domain** (optional):
   - In Vercel project settings > Domains
   - Add your domain (e.g., `talentinsight.com`)
   - Add wildcard subdomain: `*.talentinsight.com`
   - Update DNS records as shown

4. **Update Google OAuth**:
   - Add production redirect URI to Google Console:
     `https://your-domain.com/api/auth/google/callback`

## 🏗️ Architecture

### Multi-Tenant Strategy

Each company gets:
- Unique subdomain (e.g., `acme.talentinsight.com`)
- Isolated data via RLS policies
- Custom branding (logo, colors)
- Independent user management

### Subdomain Routing

The app detects subdomains and routes accordingly:
- `app.talentinsight.com` → Main company dashboard
- `acme.talentinsight.com` → ACME Corp's portal
- `candidate.acme.talentinsight.com` → Candidate application portal

### Database Structure

```
companies
├── company_users (team members)
├── positions (job openings)
├── candidates (applications)
│   ├── assessment_responses
│   ├── assessment_results
│   └── interviews
└── assessment_templates (custom questions)
```

## 📱 Key Workflows

### For Companies

1. **Onboarding**:
   - Sign up → Create company → Get subdomain
   - Customize branding
   - Add team members
   - Create positions

2. **Create Assessment**:
   - Choose default template or customize
   - Add custom questions
   - Set scoring weights

3. **Review Candidates**:
   - View all applications
   - See assessment results
   - Compare candidates
   - Schedule interviews

### For Candidates

1. **Apply**:
   - Visit company's job page
   - Fill application form
   - Upload CV
   - Submit

2. **Assessment**:
   - Receive email with assessment link
   - Complete 15-20 minute test
   - Get instant confirmation

3. **Interview**:
   - Receive calendar invite
   - Join Google Meet at scheduled time

## 🔒 Security

- Row Level Security (RLS) on all tables
- Authenticated file uploads
- Secure OAuth tokens
- Environment variable protection
- API route protection

## 🚦 Subdomain Setup on Vercel

1. **Add Wildcard Domain**:
   - In Vercel project settings
   - Add `*.yourdomain.com`

2. **DNS Configuration**:
   ```
   Type: A
   Name: *
   Value: 76.76.21.21 (Vercel's IP)
   ```

3. **Middleware for Routing**:
   The app automatically detects subdomains and routes to the correct company.

## 📊 Default Assessment Questions

The system includes 15 default questions:
- 5 Big 5 Personality questions
- 5 Work Style questions
- 5 Cognitive tests

Companies can customize or create their own.

## 🎨 Customization

Each company can customize:
- Logo
- Brand colors
- Assessment questions
- Email templates
- Application form fields

## 📈 Scaling Considerations

- Use Supabase connection pooling for high traffic
- Enable Vercel Edge caching
- Implement rate limiting on API routes
- Consider Redis for session management at scale

## 🐛 Troubleshooting

**Subdomain not working?**
- Check DNS propagation (can take 24-48 hours)
- Verify wildcard domain in Vercel
- Check middleware.ts is configured

**Google Calendar not connecting?**
- Verify OAuth redirect URIs match exactly
- Check API is enabled in Google Console
- Ensure scopes are correct

**Database connection issues?**
- Verify Supabase URL and keys
- Check RLS policies are correct
- Ensure user is authenticated

## 📝 Next Steps

1. Add email notifications (Resend/SendGrid)
2. Implement ATS integrations (Greenhouse, Lever)
3. Add video interview capability
4. Build mobile app
5. Add AI-powered insights
6. Implement candidate matching algorithm

## 🤝 Contributing

Contributions welcome! Please read CONTRIBUTING.md first.

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- Email: support@talentinsight.com
- Documentation: docs.talentinsight.com
- Discord: discord.gg/talentinsight

---

Built with ❤️ for better hiring decisions
