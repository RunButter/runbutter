// What a person can search for, and the OpenStreetMap tags that mean it.
//
// ZERO IMPORTS on purpose: the search route, the agent tool and the browser
// screen all read this list, and the agent tools file must not drag a client
// module into a route handler (see lib/workspace/blueprint.ts for why that
// matters here).
//
// A category is a LIST of tag pairs because OSM rarely has one tag per
// business: a dentist is `amenity=dentist` in most of Europe and
// `healthcare=dentist` where people mapped it later, and searching only one
// silently returns half the city. Values are fixed strings from this file —
// nothing a person types is ever put into a tag filter.

export interface LeadCategory {
  key: string;
  label: string;
  /** One of them, for a saved lead's category: "Dentist", not "Dentists". */
  one: string;
  group: string;
  /** [key, value] pairs; any match counts. */
  tags: [string, string][];
}

const c = (key: string, label: string, one: string, group: string, tags: [string, string][]): LeadCategory =>
  ({ key, label, one, group, tags });

export const LEAD_CATEGORIES: LeadCategory[] = [
  c('restaurant', 'Restaurants', 'Restaurant', 'Food & drink', [['amenity', 'restaurant']]),
  c('cafe', 'Cafés', 'Café', 'Food & drink', [['amenity', 'cafe']]),
  c('bar', 'Bars & pubs', 'Bar', 'Food & drink', [['amenity', 'bar'], ['amenity', 'pub']]),
  c('fast_food', 'Fast food', 'Fast food', 'Food & drink', [['amenity', 'fast_food']]),
  c('bakery', 'Bakeries', 'Bakery', 'Food & drink', [['shop', 'bakery'], ['shop', 'pastry']]),

  c('dentist', 'Dentists', 'Dentist', 'Health', [['amenity', 'dentist'], ['healthcare', 'dentist']]),
  c('doctor', 'Doctors & clinics', 'Clinic', 'Health', [['amenity', 'doctors'], ['amenity', 'clinic'], ['healthcare', 'doctor'], ['healthcare', 'clinic']]),
  c('pharmacy', 'Pharmacies', 'Pharmacy', 'Health', [['amenity', 'pharmacy'], ['healthcare', 'pharmacy']]),
  c('physio', 'Physiotherapists', 'Physiotherapist', 'Health', [['healthcare', 'physiotherapist']]),
  c('vet', 'Vets', 'Vet', 'Health', [['amenity', 'veterinary']]),
  c('optician', 'Opticians', 'Optician', 'Health', [['shop', 'optician'], ['healthcare', 'optometrist']]),

  c('hairdresser', 'Hairdressers & barbers', 'Hairdresser', 'Beauty & fitness', [['shop', 'hairdresser']]),
  c('beauty', 'Beauty salons', 'Beauty salon', 'Beauty & fitness', [['shop', 'beauty'], ['shop', 'cosmetics']]),
  c('massage', 'Massage & spa', 'Massage & spa', 'Beauty & fitness', [['shop', 'massage'], ['leisure', 'spa']]),
  c('tattoo', 'Tattoo studios', 'Tattoo studio', 'Beauty & fitness', [['shop', 'tattoo']]),
  c('gym', 'Gyms & fitness', 'Gym', 'Beauty & fitness', [['leisure', 'fitness_centre'], ['leisure', 'sports_centre']]),

  c('hotel', 'Hotels', 'Hotel', 'Travel & stay', [['tourism', 'hotel'], ['tourism', 'motel']]),
  c('guest_house', 'Guest houses & hostels', 'Guest house', 'Travel & stay', [['tourism', 'guest_house'], ['tourism', 'hostel'], ['tourism', 'apartment']]),
  c('travel_agency', 'Travel agencies', 'Travel agency', 'Travel & stay', [['shop', 'travel_agency'], ['office', 'travel_agent']]),

  c('car_repair', 'Car repair', 'Car repair', 'Cars', [['shop', 'car_repair']]),
  c('car_dealer', 'Car dealers', 'Car dealer', 'Cars', [['shop', 'car']]),
  c('car_wash', 'Car washes', 'Car wash', 'Cars', [['amenity', 'car_wash']]),
  c('tyres', 'Tyre shops', 'Tyre shop', 'Cars', [['shop', 'tyres']]),

  c('lawyer', 'Lawyers', 'Lawyer', 'Offices', [['office', 'lawyer']]),
  c('notary', 'Notaries', 'Notary', 'Offices', [['office', 'notary']]),
  c('accountant', 'Accountants', 'Accountant', 'Offices', [['office', 'accountant'], ['office', 'tax_advisor']]),
  c('estate_agent', 'Estate agents', 'Estate agent', 'Offices', [['office', 'estate_agent'], ['shop', 'estate_agent']]),
  c('insurance', 'Insurance', 'Insurance', 'Offices', [['office', 'insurance']]),
  c('it', 'IT companies', 'IT company', 'Offices', [['office', 'it'], ['office', 'telecommunication']]),
  c('architect', 'Architects', 'Architect', 'Offices', [['office', 'architect']]),
  c('marketing', 'Marketing & ad agencies', 'Marketing agency', 'Offices', [['office', 'advertising_agency'], ['office', 'marketing']]),
  c('recruitment', 'Recruitment agencies', 'Recruitment agency', 'Offices', [['office', 'employment_agency']]),
  c('coworking', 'Coworking spaces', 'Coworking space', 'Offices', [['amenity', 'coworking_space'], ['office', 'coworking']]),
  c('company', 'Other company offices', 'Company office', 'Offices', [['office', 'company']]),

  c('plumber', 'Plumbers', 'Plumber', 'Trades', [['craft', 'plumber']]),
  c('electrician', 'Electricians', 'Electrician', 'Trades', [['craft', 'electrician']]),
  c('builder', 'Builders', 'Builder', 'Trades', [['craft', 'builder'], ['office', 'construction_company']]),
  c('carpenter', 'Carpenters', 'Carpenter', 'Trades', [['craft', 'carpenter'], ['craft', 'joiner']]),
  c('painter', 'Painters & decorators', 'Painter', 'Trades', [['craft', 'painter']]),
  c('roofer', 'Roofers', 'Roofer', 'Trades', [['craft', 'roofer']]),
  c('hvac', 'Heating & air conditioning', 'Heating & AC', 'Trades', [['craft', 'hvac'], ['craft', 'heating_engineer']]),
  c('photographer', 'Photographers', 'Photographer', 'Trades', [['craft', 'photographer'], ['shop', 'photo']]),
  c('printer', 'Printers & copy shops', 'Print shop', 'Trades', [['shop', 'copyshop'], ['craft', 'printer']]),

  c('clothes', 'Clothing shops', 'Clothing shop', 'Shops', [['shop', 'clothes'], ['shop', 'shoes']]),
  c('florist', 'Florists', 'Florist', 'Shops', [['shop', 'florist']]),
  c('furniture', 'Furniture shops', 'Furniture shop', 'Shops', [['shop', 'furniture'], ['shop', 'interior_decoration']]),
  c('electronics', 'Electronics & phones', 'Electronics shop', 'Shops', [['shop', 'electronics'], ['shop', 'computer'], ['shop', 'mobile_phone']]),
  c('hardware', 'Hardware & DIY', 'Hardware shop', 'Shops', [['shop', 'hardware'], ['shop', 'doityourself']]),
  c('grocery', 'Grocery shops', 'Grocery shop', 'Shops', [['shop', 'supermarket'], ['shop', 'convenience'], ['shop', 'greengrocer']]),
  c('jewellery', 'Jewellers', 'Jeweller', 'Shops', [['shop', 'jewelry']]),
  c('pet_shop', 'Pet shops', 'Pet shop', 'Shops', [['shop', 'pet']]),
  c('bookshop', 'Bookshops', 'Bookshop', 'Shops', [['shop', 'books']]),
  c('cleaning', 'Laundry & dry cleaning', 'Laundry', 'Shops', [['shop', 'laundry'], ['shop', 'dry_cleaning']]),

  c('language_school', 'Language schools', 'Language school', 'Education', [['amenity', 'language_school']]),
  c('driving_school', 'Driving schools', 'Driving school', 'Education', [['amenity', 'driving_school']]),
  c('kindergarten', 'Kindergartens', 'Kindergarten', 'Education', [['amenity', 'kindergarten']]),
];

export const CATEGORY_BY_KEY: Record<string, LeadCategory> =
  Object.fromEntries(LEAD_CATEGORIES.map((x) => [x.key, x]));

/** The tag a found place matched, said as a person would ("Dentist"), for the record's category. */
export function categoryLabelFor(tags: Record<string, string>): string {
  for (const cat of LEAD_CATEGORIES) {
    if (cat.tags.some(([k, v]) => tags[k] === v)) return cat.one;
  }
  const raw = tags.shop || tags.office || tags.craft || tags.amenity || tags.healthcare || tags.tourism || tags.leisure || '';
  return raw ? raw.replace(/_/g, ' ').replace(/^\w/, (s) => s.toUpperCase()) : '';
}
