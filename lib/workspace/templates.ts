import { isKnownIcon, type Blueprint } from './blueprint';

/**
 * Vertical starting points.
 *
 * WHY THESE EXIST ALONGSIDE THE AI BUILDER. They work with no AI key, on the
 * free plan, instantly and identically every time — which the AI path cannot
 * promise. They are also the few-shot examples the model is shown, so the two
 * halves cannot drift: improving a template improves what the AI produces.
 *
 * WHAT THEY DELIBERATELY DO NOT DO: reinvent a built-in. None of these adds a
 * "Customer" or an "Invoice", because companies, people, invoices, expenses,
 * projects and the rest already exist and already talk to the finance ledger,
 * the pipeline and the agents. A template adds only what this industry has that
 * a general business does not — which is also why each one is small. A
 * fifty-field blueprint is a thing nobody reads before clicking Create.
 *
 * They are opinions, not research. Someone in the trade will want to change
 * them, and that is the point of them being editable the moment they land.
 */

export interface WorkspaceTemplate {
  id: string;
  name: string;
  /** Who it is for, in the words they would use about themselves. */
  audience: string;
  icon: string;
  blueprint: Blueprint;
}

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'transport',
    name: 'Transport & logistics',
    audience: 'Hauliers, couriers, and anyone who runs vehicles',
    icon: 'Truck',
    blueprint: {
      summary: 'Vehicles, drivers and the loads they carry — on top of the companies and invoices you already have.',
      objects: [
        {
          singular: 'Vehicle', plural: 'Vehicles', slug: 'vehicles', group: 'Fleet', icon: 'Truck',
          description: 'Everything you drive, and when it is next due off the road',
          fields: [
            { label: 'Plate', key: 'plate', type: 'text', primary: true, required: true },
            { label: 'Make & model', key: 'model', type: 'text' },
            { label: 'MOT due', key: 'mot_due', type: 'date' },
            { label: 'Insurance due', key: 'insurance_due', type: 'date' },
            { label: 'Mileage', key: 'mileage', type: 'number' },
            { label: 'Status', key: 'status', type: 'select', options: ['active', 'in service', 'off road', 'sold'] },
          ],
        },
        {
          singular: 'Driver', plural: 'Drivers', slug: 'drivers', group: 'Fleet', icon: 'IdCard',
          description: 'Licences and the dates that matter',
          fields: [
            { label: 'Name', key: 'name', type: 'text', primary: true, required: true },
            { label: 'Licence number', key: 'licence', type: 'text' },
            { label: 'Licence expires', key: 'licence_expires', type: 'date' },
            { label: 'Phone', key: 'phone', type: 'phone' },
            { label: 'Available', key: 'available', type: 'checkbox' },
          ],
        },
        {
          singular: 'Load', plural: 'Loads', slug: 'loads', group: 'Fleet', icon: 'Package',
          description: 'One job: from here, to there, for this customer',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            // Points at the built-in companies object — a template's job is to
            // connect to what is already there, not to duplicate it.
            { label: 'Customer', key: 'customer', type: 'relation', relation_to: 'companies' },
            { label: 'Collect from', key: 'collect_from', type: 'text' },
            { label: 'Deliver to', key: 'deliver_to', type: 'text' },
            { label: 'Collection date', key: 'collect_on', type: 'date' },
            { label: 'Rate', key: 'rate', type: 'currency' },
            { label: 'Status', key: 'status', type: 'select', options: ['booked', 'loading', 'in transit', 'delivered', 'invoiced'] },
          ],
        },
      ],
    },
  },
  {
    id: 'clinic',
    name: 'Clinic & health',
    audience: 'Dentists, physios, private practice',
    icon: 'Stethoscope',
    blueprint: {
      summary: 'Patients, appointments and treatments, kept beside your invoicing.',
      objects: [
        {
          singular: 'Patient', plural: 'Patients', slug: 'patients', group: 'Practice', icon: 'HeartPulse',
          description: 'Who you see, and how to reach them',
          fields: [
            { label: 'Name', key: 'name', type: 'text', primary: true, required: true },
            { label: 'Date of birth', key: 'dob', type: 'date' },
            { label: 'Phone', key: 'phone', type: 'phone' },
            { label: 'Email', key: 'email', type: 'email' },
            { label: 'Notes', key: 'notes', type: 'long_text' },
          ],
        },
        {
          singular: 'Appointment', plural: 'Appointments', slug: 'appointments', group: 'Practice', icon: 'CalendarClock',
          description: 'When they are coming in and what for',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Patient', key: 'patient', type: 'relation', relation_to: 'patients' },
            { label: 'Date', key: 'date', type: 'date' },
            { label: 'Treatment', key: 'treatment', type: 'text' },
            { label: 'Status', key: 'status', type: 'select', options: ['booked', 'attended', 'cancelled', 'no show'] },
            { label: 'Fee', key: 'fee', type: 'currency' },
          ],
        },
      ],
    },
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    audience: 'Workshops, factories, production lines',
    icon: 'Factory',
    blueprint: {
      summary: 'Machines, production runs and maintenance — beside the products and orders you already track.',
      objects: [
        {
          singular: 'Machine', plural: 'Machines', slug: 'machines', group: 'Production', icon: 'Cog',
          description: 'What is on the floor, and when it was last serviced',
          fields: [
            { label: 'Name', key: 'name', type: 'text', primary: true, required: true },
            { label: 'Serial number', key: 'serial', type: 'text' },
            { label: 'Location', key: 'location', type: 'text' },
            { label: 'Last service', key: 'last_service', type: 'date' },
            { label: 'Next service', key: 'next_service', type: 'date' },
            { label: 'Status', key: 'status', type: 'select', options: ['running', 'idle', 'maintenance', 'broken'] },
          ],
        },
        {
          singular: 'Production run', plural: 'Production runs', slug: 'production_runs', group: 'Production', icon: 'Layers',
          description: 'One batch, start to finish',
          fields: [
            { label: 'Batch', key: 'batch', type: 'text', primary: true, required: true },
            { label: 'Product', key: 'product', type: 'relation', relation_to: 'products' },
            { label: 'Machine', key: 'machine', type: 'relation', relation_to: 'machines' },
            { label: 'Quantity', key: 'quantity', type: 'number' },
            { label: 'Started', key: 'started', type: 'date' },
            { label: 'Finished', key: 'finished', type: 'date' },
            { label: 'Status', key: 'status', type: 'select', options: ['planned', 'running', 'done', 'scrapped'] },
          ],
        },
      ],
    },
  },
  {
    id: 'agency',
    name: 'Agency & studio',
    audience: 'Design, dev and marketing shops',
    icon: 'Palette',
    blueprint: {
      summary: 'Retainers and time, on top of the projects, invoices and people already built in.',
      objects: [
        {
          singular: 'Retainer', plural: 'Retainers', slug: 'retainers', group: 'Clients', icon: 'Repeat',
          description: 'What a client pays every month, and what it buys',
          fields: [
            { label: 'Name', key: 'name', type: 'text', primary: true, required: true },
            { label: 'Client', key: 'client', type: 'relation', relation_to: 'companies' },
            { label: 'Monthly fee', key: 'monthly_fee', type: 'currency' },
            { label: 'Hours included', key: 'hours_included', type: 'number' },
            { label: 'Renews', key: 'renews_on', type: 'date' },
            { label: 'Status', key: 'status', type: 'select', options: ['active', 'paused', 'ended'] },
          ],
        },
        {
          singular: 'Time entry', plural: 'Time entries', slug: 'time_entries', group: 'Clients', icon: 'Timer',
          description: 'Hours against a project, so a retainer can be checked against reality',
          fields: [
            { label: 'Summary', key: 'summary', type: 'text', primary: true, required: true },
            { label: 'Project', key: 'project', type: 'relation', relation_to: 'projects' },
            { label: 'Date', key: 'date', type: 'date' },
            { label: 'Hours', key: 'hours', type: 'number' },
            { label: 'Billable', key: 'billable', type: 'checkbox' },
          ],
        },
      ],
    },
  },
  {
    id: 'property',
    name: 'Property & lettings',
    audience: 'Landlords, letting agents, facilities',
    icon: 'Building',
    blueprint: {
      summary: 'Properties, tenancies and the jobs that come with them.',
      objects: [
        {
          singular: 'Property', plural: 'Properties', slug: 'properties', group: 'Portfolio', icon: 'Home',
          description: 'What you own or manage',
          fields: [
            { label: 'Address', key: 'address', type: 'text', primary: true, required: true },
            { label: 'Type', key: 'type', type: 'select', options: ['flat', 'house', 'office', 'unit'] },
            { label: 'Bedrooms', key: 'bedrooms', type: 'number' },
            { label: 'Monthly rent', key: 'rent', type: 'currency' },
            { label: 'Status', key: 'status', type: 'select', options: ['let', 'vacant', 'refurbishing'] },
          ],
        },
        {
          singular: 'Tenancy', plural: 'Tenancies', slug: 'tenancies', group: 'Portfolio', icon: 'FileSignature',
          description: 'Who is in it, and until when',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Property', key: 'property', type: 'relation', relation_to: 'properties' },
            { label: 'Tenant', key: 'tenant', type: 'relation', relation_to: 'people' },
            { label: 'Starts', key: 'starts_on', type: 'date' },
            { label: 'Ends', key: 'ends_on', type: 'date' },
            { label: 'Deposit', key: 'deposit', type: 'currency' },
          ],
        },
        {
          singular: 'Maintenance job', plural: 'Maintenance jobs', slug: 'maintenance_jobs', group: 'Portfolio', icon: 'Wrench',
          description: 'Something that needs fixing',
          fields: [
            { label: 'Summary', key: 'summary', type: 'text', primary: true, required: true },
            { label: 'Property', key: 'property', type: 'relation', relation_to: 'properties' },
            { label: 'Reported', key: 'reported_on', type: 'date' },
            { label: 'Priority', key: 'priority', type: 'select', options: ['low', 'normal', 'urgent', 'emergency'] },
            { label: 'Cost', key: 'cost', type: 'currency' },
            { label: 'Done', key: 'done', type: 'checkbox' },
          ],
        },
      ],
    },
  },
  {
    id: 'construction',
    name: 'Construction & trades',
    audience: 'Builders, electricians, plumbers, fit-out firms',
    icon: 'HardHat',
    blueprint: {
      summary: 'Sites, the trades working on them, and the safety paperwork that has to exist when someone asks.',
      objects: [
        {
          singular: 'Job site', plural: 'Job sites', slug: 'job_sites', group: 'Sites', icon: 'HardHat',
          description: 'One address you are working at, and who it is for',
          fields: [
            { label: 'Site name', key: 'name', type: 'text', primary: true, required: true },
            { label: 'Address', key: 'address', type: 'text' },
            { label: 'Client', key: 'client', type: 'relation', relation_to: 'companies' },
            { label: 'Site manager', key: 'manager', type: 'relation', relation_to: 'people' },
            { label: 'Starts', key: 'starts_on', type: 'date' },
            { label: 'Due', key: 'due_on', type: 'date' },
            { label: 'Contract value', key: 'value', type: 'currency' },
            { label: 'Status', key: 'status', type: 'select', options: ['tendering', 'won', 'on site', 'snagging', 'complete'] },
          ],
        },
        {
          singular: 'Subcontract', plural: 'Subcontracts', slug: 'subcontracts', group: 'Sites', icon: 'Handshake',
          description: 'A trade booked onto a site, and what they are owed',
          fields: [
            { label: 'Package', key: 'package', type: 'text', primary: true, required: true },
            { label: 'Site', key: 'site', type: 'relation', relation_to: 'job_sites' },
            { label: 'Firm', key: 'firm', type: 'relation', relation_to: 'companies' },
            { label: 'Trade', key: 'trade', type: 'select', options: ['groundworks', 'frame', 'roofing', 'electrical', 'plumbing', 'plastering', 'joinery', 'decorating', 'other'] },
            { label: 'Agreed price', key: 'price', type: 'currency' },
            { label: 'On site from', key: 'on_site_from', type: 'date' },
            { label: 'Insurance seen', key: 'insurance_seen', type: 'checkbox' },
          ],
        },
        {
          singular: 'Site inspection', plural: 'Site inspections', slug: 'site_inspections', group: 'Sites', icon: 'ClipboardList',
          description: 'The walk-round record — the thing you need to produce when someone asks',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Site', key: 'site', type: 'relation', relation_to: 'job_sites' },
            { label: 'Date', key: 'date', type: 'date' },
            { label: 'Inspector', key: 'inspector', type: 'relation', relation_to: 'people' },
            { label: 'Type', key: 'type', type: 'select', options: ['safety', 'quality', 'client', 'building control'] },
            { label: 'Findings', key: 'findings', type: 'long_text' },
            { label: 'Actions closed', key: 'closed', type: 'checkbox' },
          ],
        },
      ],
    },
  },
  {
    id: 'retail',
    name: 'Retail & e-commerce',
    audience: 'Shops and online sellers shipping physical goods',
    icon: 'ShoppingCart',
    blueprint: {
      summary: 'Orders and returns against the product catalogue you already have.',
      objects: [
        {
          singular: 'Order', plural: 'Orders', slug: 'orders', group: 'Orders', icon: 'ShoppingCart',
          description: 'One order, from paid to delivered',
          fields: [
            { label: 'Order number', key: 'number', type: 'text', primary: true, required: true },
            { label: 'Customer', key: 'customer', type: 'relation', relation_to: 'people' },
            { label: 'Placed', key: 'placed_on', type: 'date' },
            { label: 'Channel', key: 'channel', type: 'select', options: ['website', 'marketplace', 'in store', 'phone'] },
            // Lines as text rather than a child object: a blueprint cannot
            // express a one-to-many table, and pretending otherwise with eight
            // "item 1..8" fields is worse than one honest field someone can read.
            { label: 'Items', key: 'items', type: 'long_text' },
            { label: 'Total', key: 'total', type: 'currency' },
            { label: 'Shipping address', key: 'ship_to', type: 'long_text' },
            { label: 'Tracking', key: 'tracking', type: 'text' },
            { label: 'Status', key: 'status', type: 'select', options: ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'] },
          ],
        },
        {
          singular: 'Return', plural: 'Returns', slug: 'returns', group: 'Orders', icon: 'Undo2',
          description: 'Something coming back, and why',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Order', key: 'order', type: 'relation', relation_to: 'orders' },
            { label: 'Product', key: 'product', type: 'relation', relation_to: 'products' },
            { label: 'Reason', key: 'reason', type: 'select', options: ['faulty', 'wrong item', 'not as described', 'changed mind', 'damaged in transit'] },
            { label: 'Received', key: 'received_on', type: 'date' },
            { label: 'Refund', key: 'refund', type: 'currency' },
            { label: 'Resolved', key: 'resolved', type: 'checkbox' },
          ],
        },
      ],
    },
  },
  {
    id: 'education',
    name: 'Training & education',
    audience: 'Course providers, bootcamps, tutoring, driving schools',
    icon: 'GraduationCap',
    blueprint: {
      summary: 'Courses, the groups running them and who is enrolled — students are people, so the invoicing already works.',
      objects: [
        {
          singular: 'Course', plural: 'Courses', slug: 'courses', group: 'Teaching', icon: 'BookOpen',
          description: 'What you teach, once, regardless of when it runs',
          fields: [
            { label: 'Title', key: 'title', type: 'text', primary: true, required: true },
            { label: 'Code', key: 'code', type: 'text' },
            { label: 'Level', key: 'level', type: 'select', options: ['intro', 'intermediate', 'advanced', 'certification'] },
            { label: 'Hours', key: 'hours', type: 'number' },
            { label: 'Price', key: 'price', type: 'currency' },
            { label: 'Outline', key: 'outline', type: 'long_text' },
          ],
        },
        {
          singular: 'Cohort', plural: 'Cohorts', slug: 'cohorts', group: 'Teaching', icon: 'Calendar',
          description: 'One run of a course, with dates and a tutor',
          fields: [
            { label: 'Name', key: 'name', type: 'text', primary: true, required: true },
            { label: 'Course', key: 'course', type: 'relation', relation_to: 'courses' },
            { label: 'Tutor', key: 'tutor', type: 'relation', relation_to: 'people' },
            { label: 'Starts', key: 'starts_on', type: 'date' },
            { label: 'Ends', key: 'ends_on', type: 'date' },
            { label: 'Places', key: 'places', type: 'number' },
            { label: 'Delivery', key: 'delivery', type: 'select', options: ['in person', 'online', 'hybrid'] },
          ],
        },
        {
          singular: 'Enrolment', plural: 'Enrolments', slug: 'enrolments', group: 'Teaching', icon: 'GraduationCap',
          description: 'One student on one cohort',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Student', key: 'student', type: 'relation', relation_to: 'people' },
            { label: 'Cohort', key: 'cohort', type: 'relation', relation_to: 'cohorts' },
            { label: 'Enrolled', key: 'enrolled_on', type: 'date' },
            { label: 'Fee paid', key: 'fee_paid', type: 'checkbox' },
            { label: 'Status', key: 'status', type: 'select', options: ['applied', 'enrolled', 'attending', 'completed', 'withdrawn'] },
            { label: 'Result', key: 'result', type: 'text' },
          ],
        },
      ],
    },
  },
  {
    id: 'nonprofit',
    name: 'Charity & nonprofit',
    audience: 'Charities, foundations, community groups',
    icon: 'HeartHandshake',
    blueprint: {
      summary: 'Donations, grant applications and volunteer time — donors are people and companies, so the ledger is already right.',
      objects: [
        {
          singular: 'Donation', plural: 'Donations', slug: 'donations', group: 'Fundraising', icon: 'Gift',
          description: 'Money in, and who it came from',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Donor', key: 'donor', type: 'relation', relation_to: 'people' },
            { label: 'Organisation', key: 'organisation', type: 'relation', relation_to: 'companies' },
            { label: 'Amount', key: 'amount', type: 'currency' },
            { label: 'Received', key: 'received_on', type: 'date' },
            { label: 'Kind', key: 'kind', type: 'select', options: ['one off', 'regular', 'in memory', 'in kind', 'legacy'] },
            { label: 'Gift Aid', key: 'gift_aid', type: 'checkbox' },
            { label: 'Restricted to', key: 'restricted_to', type: 'text' },
          ],
        },
        {
          singular: 'Grant', plural: 'Grants', slug: 'grants', group: 'Fundraising', icon: 'FileSignature',
          description: 'An application and its deadlines — the dates are the whole job',
          fields: [
            { label: 'Name', key: 'name', type: 'text', primary: true, required: true },
            { label: 'Funder', key: 'funder', type: 'relation', relation_to: 'companies' },
            { label: 'Amount requested', key: 'requested', type: 'currency' },
            { label: 'Amount awarded', key: 'awarded', type: 'currency' },
            { label: 'Deadline', key: 'deadline', type: 'date' },
            { label: 'Report due', key: 'report_due', type: 'date' },
            { label: 'Stage', key: 'stage', type: 'select', options: ['researching', 'drafting', 'submitted', 'awarded', 'rejected', 'reporting'] },
          ],
        },
        {
          singular: 'Volunteer shift', plural: 'Volunteer shifts', slug: 'volunteer_shifts', group: 'Fundraising', icon: 'Users',
          description: 'Who turned up, when, and for how long',
          fields: [
            { label: 'Summary', key: 'summary', type: 'text', primary: true, required: true },
            { label: 'Volunteer', key: 'volunteer', type: 'relation', relation_to: 'people' },
            { label: 'Date', key: 'date', type: 'date' },
            { label: 'Hours', key: 'hours', type: 'number' },
            { label: 'Activity', key: 'activity', type: 'text' },
            { label: 'Attended', key: 'attended', type: 'checkbox' },
          ],
        },
      ],
    },
  },
  {
    id: 'field-service',
    name: 'Field service & repairs',
    audience: 'Installers, engineers, anyone with a van and a callout list',
    icon: 'Wrench',
    blueprint: {
      summary: 'Callouts, the kit you maintain and the contracts that cover it.',
      objects: [
        {
          singular: 'Work order', plural: 'Work orders', slug: 'work_orders', group: 'Service', icon: 'ClipboardList',
          description: 'One visit: who, where, what went wrong',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Customer', key: 'customer', type: 'relation', relation_to: 'companies' },
            { label: 'Equipment', key: 'equipment', type: 'relation', relation_to: 'equipment' },
            { label: 'Engineer', key: 'engineer', type: 'relation', relation_to: 'people' },
            { label: 'Reported', key: 'reported_on', type: 'date' },
            { label: 'Scheduled', key: 'scheduled_on', type: 'date' },
            { label: 'Priority', key: 'priority', type: 'select', options: ['routine', 'next day', 'same day', 'emergency'] },
            { label: 'Fault', key: 'fault', type: 'long_text' },
            { label: 'Status', key: 'status', type: 'select', options: ['open', 'scheduled', 'on site', 'parts needed', 'done', 'invoiced'] },
          ],
        },
        {
          singular: 'Equipment', plural: 'Equipment', slug: 'equipment', group: 'Service', icon: 'Cog',
          description: 'A unit you installed or look after, at a customer site',
          fields: [
            { label: 'Label', key: 'label', type: 'text', primary: true, required: true },
            { label: 'Serial number', key: 'serial', type: 'text' },
            { label: 'Customer', key: 'customer', type: 'relation', relation_to: 'companies' },
            { label: 'Installed', key: 'installed_on', type: 'date' },
            { label: 'Warranty ends', key: 'warranty_ends', type: 'date' },
            { label: 'Next service', key: 'next_service', type: 'date' },
            { label: 'Location', key: 'location', type: 'text' },
          ],
        },
        {
          singular: 'Service contract', plural: 'Service contracts', slug: 'service_contracts', group: 'Service', icon: 'Repeat',
          description: 'What a customer is entitled to, and until when',
          fields: [
            { label: 'Reference', key: 'reference', type: 'text', primary: true, required: true },
            { label: 'Customer', key: 'customer', type: 'relation', relation_to: 'companies' },
            { label: 'Cover', key: 'cover', type: 'select', options: ['parts only', 'labour only', 'parts and labour', 'full cover'] },
            { label: 'Response time', key: 'response', type: 'text' },
            { label: 'Annual fee', key: 'annual_fee', type: 'currency' },
            { label: 'Renews', key: 'renews_on', type: 'date' },
            { label: 'Visits per year', key: 'visits_per_year', type: 'number' },
          ],
        },
      ],
    },
  },
];

export const templateById = (id: string) => WORKSPACE_TEMPLATES.find((t) => t.id === id);

/**
 * Fail at import if a template picks an icon the app cannot draw.
 *
 * An unknown name is not an error anywhere at runtime — normalizeBlueprint
 * quietly swaps in the table glyph — which is exactly why this has to be
 * checked here. Every object these templates create was showing the generic
 * people icon before the vocabulary existed, and nothing said so.
 */
const badIcons = WORKSPACE_TEMPLATES.flatMap((t) =>
  [t.icon, ...t.blueprint.objects.map((o) => o.icon || '')]
    .filter((i) => i && !isKnownIcon(i))
    .map((i) => `${t.id}: ${i}`));
if (badIcons.length) {
  throw new Error(`workspace templates use icons outside OBJECT_ICON_NAMES — ${badIcons.join(', ')}`);
}
