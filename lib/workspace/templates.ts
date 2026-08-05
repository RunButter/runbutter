import type { Blueprint } from './blueprint';

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
];

export const templateById = (id: string) => WORKSPACE_TEMPLATES.find((t) => t.id === id);
