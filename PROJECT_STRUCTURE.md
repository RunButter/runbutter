# TalentInsight - Project Structure

```
talent-insight/
│
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Landing page
│   ├── globals.css              # Global styles
│   │
│   ├── auth/                    # Authentication pages
│   │   ├── login/
│   │   ├── register/
│   │   └── callback/
│   │
│   ├── dashboard/               # Company dashboard (protected)
│   │   ├── page.tsx            # Dashboard home
│   │   ├── candidates/         # Candidate management
│   │   ├── positions/          # Job positions
│   │   ├── assessments/        # Assessment templates
│   │   ├── team/               # Team management
│   │   ├── settings/           # Company settings
│   │   └── analytics/          # Analytics & reports
│   │
│   ├── apply/                   # Candidate application portal
│   │   └── [positionId]/
│   │       ├── page.tsx        # Application form
│   │       └── assessment/     # Assessment flow
│   │
│   └── api/                     # API routes
│       ├── auth/
│       │   └── google/
│       │       └── callback/
│       ├── candidates/
│       ├── assessments/
│       ├── interviews/
│       └── webhooks/
│
├── components/                  # React components
│   ├── ui/                     # UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   └── Select.tsx
│   │
│   ├── dashboard/              # Dashboard-specific
│   │   ├── CandidateList.tsx
│   │   ├── CandidateCard.tsx
│   │   ├── AssessmentResults.tsx
│   │   ├── PersonalityChart.tsx
│   │   └── InterviewScheduler.tsx
│   │
│   ├── assessment/             # Assessment components
│   │   ├── QuestionCard.tsx
│   │   ├── ProgressBar.tsx
│   │   └── ResultsView.tsx
│   │
│   └── layout/                 # Layout components
│       ├── Header.tsx
│       ├── Sidebar.tsx
│       └── Footer.tsx
│
├── lib/                        # Utilities & helpers
│   ├── supabase.ts            # Supabase client
│   ├── google-calendar.ts     # Google Calendar API
│   ├── assessment-scoring.ts  # Assessment scoring logic
│   ├── utils.ts               # General utilities
│   └── constants.ts           # Constants
│
├── types/                      # TypeScript types
│   ├── database.ts            # Database types
│   ├── assessment.ts          # Assessment types
│   └── api.ts                 # API response types
│
├── public/                     # Static files
│   ├── logo.svg
│   └── images/
│
├── supabase-schema.sql         # Database schema
├── package.json
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── DEPLOYMENT.md
└── setup.sh
```

## Key Files Explained

### Core Configuration

**package.json**
- Dependencies: Next.js, React, Supabase, Google APIs, Chart.js
- Scripts: dev, build, start, lint

**next.config.js**
- Image domains
- API rewrites
- Environment configuration

**tailwind.config.js**
- Custom colors (primary brand palette)
- Component utilities

### Database & Backend

**supabase-schema.sql**
- Complete database schema
- Tables: companies, users, candidates, assessments, interviews
- Row Level Security (RLS) policies
- Indexes and triggers
- Storage bucket setup

**lib/supabase.ts**
- Supabase client initialization
- Storage helpers (CV upload, logo upload)
- Type-safe database queries

**lib/google-calendar.ts**
- OAuth flow management
- Calendar event creation
- Google Meet link generation
- Event updates and cancellations

### Frontend

**app/page.tsx**
- Marketing landing page
- Features showcase
- Pricing tiers
- CTA sections

**app/dashboard/**
- Protected admin interface
- Candidate pipeline view
- Assessment results
- Interview scheduling
- Team management

**app/apply/**
- Public candidate portal
- Job application form
- CV upload
- Assessment flow

### Components

**components/ui/**
- Reusable UI primitives
- Consistent styling
- Accessibility features

**components/dashboard/**
- Complex dashboard widgets
- Data visualization
- Interactive charts

**components/assessment/**
- Question display
- Progress tracking
- Results presentation

## Data Flow

### Candidate Application Flow
```
1. Candidate visits job.company.talentinsight.com/apply/[positionId]
2. Fills application form + uploads CV
3. Data saved to 'candidates' table
4. CV uploaded to Supabase Storage
5. Candidate receives assessment link via email
6. Completes assessment → saved to 'assessment_responses'
7. Results calculated → saved to 'assessment_results'
8. Admin sees candidate in dashboard
```

### Interview Scheduling Flow
```
1. Admin selects candidate
2. Clicks "Schedule Interview"
3. Connects Google Calendar (if first time)
4. Selects date/time and interviewer
5. Creates Google Calendar event with Meet link
6. Event ID saved to 'interviews' table
7. Candidate receives calendar invite
8. Interview details visible in dashboard
```

### Multi-Tenant Architecture
```
1. User registers → creates company
2. Company assigned unique subdomain
3. Subdomain stored in 'companies' table
4. All requests check subdomain
5. Database queries filtered by company_id (via RLS)
6. Each company sees only their data
```

## Security Model

### Row Level Security (RLS)
- Every table has RLS enabled
- Policies check `auth.uid()` matches `company_users.auth_user_id`
- Users can only see data from their company
- Candidates can only see their own data

### Authentication
- Supabase Auth handles user management
- OAuth integration for Google
- Session-based authentication
- Protected API routes

### File Storage
- CVs stored in private bucket
- Only authenticated users can upload
- Company logos in public bucket
- Signed URLs for secure access

## API Routes

### Authentication
- `POST /api/auth/register` - Company registration
- `POST /api/auth/login` - User login
- `GET /api/auth/google/callback` - OAuth callback

### Candidates
- `GET /api/candidates` - List candidates
- `POST /api/candidates` - Create candidate
- `GET /api/candidates/[id]` - Get candidate details
- `PATCH /api/candidates/[id]` - Update candidate

### Assessments
- `POST /api/assessments/submit` - Submit assessment
- `GET /api/assessments/[id]/results` - Get results
- `POST /api/assessments/templates` - Create template

### Interviews
- `POST /api/interviews/schedule` - Schedule interview
- `PATCH /api/interviews/[id]` - Update interview
- `DELETE /api/interviews/[id]` - Cancel interview

## Environment Variables

Required for production:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
NEXT_PUBLIC_APP_URL
```

## Development Workflow

1. **Start development**:
   ```bash
   npm run dev
   ```

2. **Make changes**:
   - Edit files in `app/`, `components/`, or `lib/`
   - Changes hot-reload automatically

3. **Test locally**:
   - Create test company
   - Add test candidates
   - Complete assessments
   - Schedule interviews

4. **Deploy**:
   ```bash
   git push origin main
   # Vercel auto-deploys
   ```

## Future Enhancements

### Planned Features
- [ ] Email notifications (Resend/SendGrid)
- [ ] ATS integrations (Greenhouse, Lever)
- [ ] AI-powered candidate matching
- [ ] Video interview integration
- [ ] Mobile app (React Native)
- [ ] Advanced analytics dashboard
- [ ] Custom assessment builder
- [ ] Bulk candidate import
- [ ] Interview feedback forms
- [ ] Offer letter generation

### Technical Improvements
- [ ] Redis caching layer
- [ ] Job queue (Bull/BullMQ)
- [ ] Real-time updates (WebSockets)
- [ ] Advanced search (Elasticsearch)
- [ ] Performance monitoring (Sentry)
- [ ] A/B testing framework
- [ ] Internationalization (i18n)

---

This structure provides a solid foundation for a production-ready SaaS application!
