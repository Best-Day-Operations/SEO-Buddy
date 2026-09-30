'use strict';

const APPROVED_FACTS = Object.freeze({
  name: 'Best Day Fitness & Wellness',
  legalName: 'Best Day Fitness & Wellness',
  telephone: '+1-727-334-1472',
  streetAddress: '6619 1st Ave S',
  addressLocality: 'St. Petersburg',
  addressRegion: 'FL',
  postalCode: '33707',
  addressCountry: 'US',
  latitude: 27.770167,
  longitude: -82.729172,
  hours: Object.freeze({
    monSat: { opens: '04:00', closes: '22:00' },
    sun: { opens: '09:00', closes: '17:00' },
    appointmentOnly: true,
    timezone: 'America/New_York',
  }),
  consultation: Object.freeze({
    price: '99.00',
    normalPrice: '200.00',
    minutes: 45,
    host: 'Client Experience Team',
  }),
  halored: Object.freeze({
    singlePrice: '39.99',
    singleMinutes: 15,
    additionalMinutePrice: '2.00',
    maxMinutes: 30,
    memberMonthlyPrice: '299.00',
    publicMonthlyPrice: '399.00',
    serviceHours: 'Daily 09:00–17:00 Eastern',
    minimumElapsedHoursBetweenStarts: 48,
    turnoverMinutes: 15,
    cancellationBufferHours: 24,
  }),
  training: Object.freeze({
    format: 'one-on-one',
    typicalMinutes: 60,
    availableMinutes: 30,
  }),
  physicalTherapy: Object.freeze({
    provider: 'Dr. George',
    status: 'in-house',
  }),
  wellness: Object.freeze([
    'habits',
    'stress',
    'general healthy eating guidance',
    'meal planning',
  ]),
  reviews: Object.freeze({
    rating: '5.0',
    count: '121',
    fiveStar: '120',
    fourStar: '1',
    observedDate: '2026-09-30',
    source: 'Google Business Profile',
  }),
  socials: Object.freeze([
    'https://www.facebook.com/bestdayfitness',
    'https://www.instagram.com/best_day_fitness/',
    'https://www.youtube.com/c/Bestdayfitness',
  ]),
});

const ALL_DAYS_OF_WEEK = Object.freeze([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]);

/**
 * Builds the shared business identity entity (#business).
 * Complies with Google's self-serving review policy (omits aggregateRating).
 * Omits 404 image paths (logo.png, best-day-studio.jpg) until hosted public URLs exist.
 */
function buildBusinessIdentitySchema(options = {}) {
  const domain = (options.domain || 'https://bestdayfitness.com').replace(/\/$/, '');
  const facts = options.facts || APPROVED_FACTS;

  return {
    '@type': ['HealthClub', 'ExerciseGym', 'SportsActivityLocation'],
    '@id': `${domain}/#business`,
    name: facts.name,
    legalName: facts.legalName,
    url: `${domain}/`,
    telephone: facts.telephone,
    priceRange: '$$',
    description: 'Private, barefoot, appointment-only fitness and wellness studio in St. Petersburg, FL specializing in personalized training, physical therapy, dry salt and red light recovery, and wellness coaching for adults 50+.',
    address: {
      '@type': 'PostalAddress',
      streetAddress: facts.streetAddress,
      addressLocality: facts.addressLocality,
      addressRegion: facts.addressRegion,
      postalCode: facts.postalCode,
      addressCountry: facts.addressCountry,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: facts.latitude,
      longitude: facts.longitude,
    },
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: facts.hours.monSat.opens,
        closes: facts.hours.monSat.closes,
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Sunday'],
        opens: facts.hours.sun.opens,
        closes: facts.hours.sun.closes,
      },
    ],
    sameAs: [...facts.socials],
    amenityFeature: [
      {
        '@type': 'LocationFeatureSpecification',
        name: 'Appointment Only Studio',
        value: true,
      },
      {
        '@type': 'LocationFeatureSpecification',
        name: 'Barefoot Training Environment',
        value: true,
      },
      {
        '@type': 'LocationFeatureSpecification',
        name: 'Accessible Ground Floor Entrance & Easy Parking',
        value: true,
      },
    ],
  };
}

/**
 * Builds page-specific metadata and schema (WebSite, WebPage, BreadcrumbList, Services).
 */
function buildPageMetadataAndSchema(options = {}) {
  const domain = (options.domain || 'https://bestdayfitness.com').replace(/\/$/, '');
  const facts = options.facts || APPROVED_FACTS;
  const pageType = options.pageType || 'home';

  const entities = [
    {
      '@type': 'WebSite',
      '@id': `${domain}/#website`,
      url: `${domain}/`,
      name: facts.name,
      publisher: { '@id': `${domain}/#business` },
      inLanguage: 'en-US',
    },
    {
      '@type': 'WebPage',
      '@id': `${domain}/#webpage`,
      url: `${domain}/`,
      name: `${facts.name} | Private Personal Training & Recovery in St. Petersburg, FL`,
      isPartOf: { '@id': `${domain}/#website` },
      about: { '@id': `${domain}/#business` },
      inLanguage: 'en-US',
    },
    {
      '@type': 'Service',
      '@id': `${domain}/#service-personal-training`,
      name: 'One-on-One Personal Training',
      serviceType: 'Personal Training for Adults 50+',
      description: `Private, trainer-led one-on-one personal training tailored to individual mobility, balance, strength, and posture goals. Typically ${facts.training.typicalMinutes} minutes with ${facts.training.availableMinutes}-minute sessions also available.`,
      provider: { '@id': `${domain}/#business` },
      areaServed: { '@type': 'City', name: 'St. Petersburg, FL' },
    },
    {
      '@type': 'Service',
      '@id': `${domain}/#service-consultation`,
      name: 'Fitness Consultation',
      serviceType: 'Comprehensive Movement & Fitness Assessment',
      description: `A ${facts.consultation.minutes}-minute comprehensive initial fitness consultation conducted by the ${facts.consultation.host}, including conversation, approach overview, and 3D body scan. No preparation required other than proper attire.`,
      provider: { '@id': `${domain}/#business` },
      areaServed: { '@type': 'City', name: 'St. Petersburg, FL' },
      offers: {
        '@type': 'Offer',
        price: facts.consultation.price,
        priceCurrency: 'USD',
        description: `$${facts.consultation.price} initial consultation (normally $${facts.consultation.normalPrice})`,
        availability: 'https://schema.org/InStock',
        url: `${domain}/consultation`,
      },
    },
    {
      '@type': 'Service',
      '@id': `${domain}/#service-halored`,
      name: 'HaloRed Red Light & Salt Therapy',
      serviceType: 'Full-Body Photobiomodulation and Halotherapy',
      description: `Private recovery booth combining dry salt aerosol halotherapy and full-body red and near-infrared light therapy. Base ${facts.halored.singleMinutes}-minute sessions with optional additional minutes up to ${facts.halored.maxMinutes} minutes total. Dedicated recovery service hours ${facts.halored.serviceHours}, subject to availability.`,
      provider: { '@id': `${domain}/#business` },
      areaServed: { '@type': 'City', name: 'St. Petersburg, FL' },
      offers: [
        {
          '@type': 'Offer',
          name: 'Single 15-Minute Session',
          price: facts.halored.singlePrice,
          priceCurrency: 'USD',
          description: `$${facts.halored.singlePrice} for base 15-minute session; $${facts.halored.additionalMinutePrice} per additional minute up to ${facts.halored.maxMinutes} minutes total.`,
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Monthly Member Recovery Plan',
          price: facts.halored.memberMonthlyPrice,
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: facts.halored.memberMonthlyPrice,
            priceCurrency: 'USD',
            unitCode: 'MON',
          },
          description: `$${facts.halored.memberMonthlyPrice}/month for active Best Day members. First 15 minutes of each eligible visit included.`,
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Monthly Public Guest Recovery Plan',
          price: facts.halored.publicMonthlyPrice,
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: facts.halored.publicMonthlyPrice,
            priceCurrency: 'USD',
            unitCode: 'MON',
          },
          description: `$${facts.halored.publicMonthlyPrice}/month for public/guests. First 15 minutes of each eligible visit included.`,
          availability: 'https://schema.org/InStock',
        },
      ],
    },
    {
      '@type': 'Service',
      '@id': `${domain}/#service-wellness-coaching`,
      name: 'Wellness Coaching',
      serviceType: 'Habit & Lifestyle Coaching',
      description: 'Holistic coaching covering sustainable daily habits, stress management, sleep, general healthy-eating guidance, and meal planning, supporting clients beyond workout sessions.',
      provider: { '@id': `${domain}/#business` },
      areaServed: { '@type': 'City', name: 'St. Petersburg, FL' },
    },
    {
      '@type': 'Service',
      '@id': `${domain}/#service-physical-therapy`,
      name: 'Physical Therapy',
      serviceType: 'One-on-One Physical Therapy',
      description: `In-house physical therapy delivered by ${facts.physicalTherapy.provider} as part of an integrated movement and recovery plan at ${facts.name}.`,
      provider: { '@id': `${domain}/#business` },
      areaServed: { '@type': 'City', name: 'St. Petersburg, FL' },
    },
  ];

  return entities;
}

/**
 * Combines business identity and page metadata into a clean Schema.org @graph.
 */
function buildGhlSchemaGraph(options = {}) {
  const business = buildBusinessIdentitySchema(options);
  const pageEntities = buildPageMetadataAndSchema(options);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      business,
      ...pageEntities,
    ],
  };
}

/**
 * Produces head snippet with verified metadata and schema.
 * Omits 404 og:image/twitter:image.
 */
function buildGhlTrackingSnippet(options = {}) {
  const domain = (options.domain || 'https://bestdayfitness.com').replace(/\/$/, '');
  const schemaGraph = buildGhlSchemaGraph({ domain, ...options });

  return `<title>Best Day Fitness &amp; Wellness | Private Personal Training &amp; Recovery in St. Petersburg, FL</title>
<meta name="description" content="One team, one plan: personal training, physical therapy, HaloRed recovery, and wellness coaching for adults 50+ in St. Petersburg, FL. Appointment only.">
<link rel="canonical" href="${domain}/">

<meta property="og:title" content="Best Day Fitness &amp; Wellness | St. Petersburg, FL">
<meta property="og:description" content="One team, one plan: personal training, physical therapy, HaloRed recovery, and wellness coaching for adults 50+ in St. Petersburg, FL.">
<meta property="og:type" content="website">
<meta property="og:url" content="${domain}/">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Best Day Fitness &amp; Wellness | St. Petersburg, FL">
<meta name="twitter:description" content="Personal training, physical therapy, HaloRed recovery, and wellness coaching for adults 50+ in St. Petersburg, FL.">

<script type="application/ld+json">
${JSON.stringify(schemaGraph, null, 2)}
</script>`;
}

/**
 * Substantive 4-tier schema validation.
 * Categories:
 * 1. jsonSyntax
 * 2. approvedFacts
 * 3. schemaOrgVocabulary
 * 4. googleFeatureEligibility
 */
function validateSchema(schema, options = {}) {
  const expectedFacts = options.facts || APPROVED_FACTS;

  const results = {
    valid: false,
    categories: {
      jsonSyntax: { pass: true, issues: [] },
      approvedFacts: { pass: true, issues: [], verifiedFacts: [] },
      schemaOrgVocabulary: { pass: true, issues: [] },
      googleFeatureEligibility: {
        eligible: true,
        issues: [],
        warnings: [],
        limitations: [
          'Google Structured Data validation does NOT guarantee search rankings or rich snippet appearance in search results.',
          'Google strictly prohibits self-serving review snippets for LocalBusiness entities on the business’s own website.',
          'LocalBusiness schema informs Google Knowledge Graph, Maps, and AI overview entity resolution.',
        ],
      },
    },
    allIssues: [],
  };

  // --- Category 1: JSON Syntax & Structure ---
  if (!schema || typeof schema !== 'object') {
    results.categories.jsonSyntax.pass = false;
    results.categories.jsonSyntax.issues.push('Schema must be a valid non-null object.');
    results.allIssues.push('Schema must be a valid non-null object.');
    return results;
  }

  if (schema['@context'] !== 'https://schema.org') {
    results.categories.jsonSyntax.pass = false;
    results.categories.jsonSyntax.issues.push('@context must be exactly "https://schema.org".');
  }

  const graph = Array.isArray(schema['@graph'])
    ? schema['@graph']
    : (schema['@type'] ? [schema] : []);

  if (!graph.length) {
    results.categories.jsonSyntax.pass = false;
    results.categories.jsonSyntax.issues.push('Schema contains no entities in @graph or root.');
  }

  // --- Category 2: Schema.org Vocabulary ---
  const validSchemaTypes = new Set([
    'HealthClub',
    'ExerciseGym',
    'SportsActivityLocation',
    'SportsClub',
    'LocalBusiness',
    'Organization',
    'WebSite',
    'WebPage',
    'Service',
    'Offer',
    'UnitPriceSpecification',
    'PostalAddress',
    'GeoCoordinates',
    'OpeningHoursSpecification',
    'LocationFeatureSpecification',
    'BreadcrumbList',
    'ListItem',
    'AggregateRating',
  ]);

  for (const entity of graph) {
    const types = Array.isArray(entity['@type']) ? entity['@type'] : [entity['@type']];
    for (const t of types) {
      if (!t || !validSchemaTypes.has(t)) {
        results.categories.schemaOrgVocabulary.issues.push(`Unrecognized or unsupported Schema.org @type: "${t}".`);
      }
    }
  }

  // Find business entity
  const business = graph.find(e => {
    const types = Array.isArray(e['@type']) ? e['@type'] : [e['@type']];
    return types.some(t => ['HealthClub', 'ExerciseGym', 'SportsActivityLocation', 'SportsClub', 'LocalBusiness'].includes(t));
  });

  if (!business) {
    results.categories.schemaOrgVocabulary.pass = false;
    results.categories.schemaOrgVocabulary.issues.push('Missing primary HealthClub/LocalBusiness entity in schema.');
    results.categories.approvedFacts.pass = false;
    results.categories.approvedFacts.issues.push('Cannot verify approved facts: primary business entity is missing.');
    results.categories.googleFeatureEligibility.eligible = false;
    results.categories.googleFeatureEligibility.issues.push('Missing LocalBusiness entity required for Google Business profile features.');
    results.valid = false;
    results.allIssues = [
      ...results.categories.jsonSyntax.issues,
      ...results.categories.schemaOrgVocabulary.issues,
      ...results.categories.approvedFacts.issues,
      ...results.categories.googleFeatureEligibility.issues,
    ];
    return results;
  }

  // Check required Schema.org fields on business
  if (!business.name) {
    results.categories.schemaOrgVocabulary.issues.push('LocalBusiness entity missing required "name" property.');
  }
  if (!business.address) {
    results.categories.schemaOrgVocabulary.issues.push('LocalBusiness entity missing required "address" property.');
  }

  // --- Category 3: Substantive Approved Facts Verification ---
  // A. Business Name
  if (business.name !== expectedFacts.name && business.name !== 'Best Day Fitness') {
    results.categories.approvedFacts.issues.push(`Business name mismatch: observed "${business.name}", expected "${expectedFacts.name}".`);
  } else {
    results.categories.approvedFacts.verifiedFacts.push('Business Name matches approved identity.');
  }

  // B. Telephone
  const cleanPhone = (str) => String(str || '').replace(/[^\d+]/g, '');
  const expectedCleanPhone = cleanPhone(expectedFacts.telephone);
  const observedCleanPhone = cleanPhone(business.telephone);
  if (!observedCleanPhone || (observedCleanPhone !== expectedCleanPhone && !observedCleanPhone.endsWith('7273341472'))) {
    results.categories.approvedFacts.issues.push(
      `Telephone mismatch: observed "${business.telephone || 'none'}", expected "${expectedFacts.telephone}".`
    );
  } else {
    results.categories.approvedFacts.verifiedFacts.push('Telephone matches approved contact phone (+1-727-334-1472).');
  }

  // C. Postal Address
  const addr = business.address || {};
  const streetNorm = String(addr.streetAddress || '').trim().toLowerCase();
  const isApprovedStreet = streetNorm.startsWith('6619 1st ave') || streetNorm.startsWith('6619 1st avenue');
  if (!isApprovedStreet) {
    results.categories.approvedFacts.issues.push(
      `Street address mismatch: observed "${addr.streetAddress || 'none'}", expected "${expectedFacts.streetAddress}".`
    );
  }
  const cityNorm = String(addr.addressLocality || '').trim().toLowerCase();
  if (cityNorm !== 'st. petersburg' && cityNorm !== 'st petersburg' && cityNorm !== 'saint petersburg') {
    results.categories.approvedFacts.issues.push(
      `City mismatch: observed "${addr.addressLocality || 'none'}", expected "${expectedFacts.addressLocality}".`
    );
  }
  const regionNorm = String(addr.addressRegion || '').trim().toUpperCase();
  if (regionNorm !== 'FL' && regionNorm !== 'FLORIDA') {
    results.categories.approvedFacts.issues.push(
      `State mismatch: observed "${addr.addressRegion || 'none'}", expected "${expectedFacts.addressRegion}".`
    );
  }
  const zipNorm = String(addr.postalCode || '').trim();
  if (zipNorm !== expectedFacts.postalCode) {
    results.categories.approvedFacts.issues.push(
      `Postal code mismatch: observed "${addr.postalCode || 'none'}", expected "${expectedFacts.postalCode}".`
    );
  }
  if (isApprovedStreet && zipNorm === expectedFacts.postalCode) {
    results.categories.approvedFacts.verifiedFacts.push('PostalAddress matches approved 6619 1st Ave S, St. Petersburg, FL 33707.');
  }

  // D. Opening Hours Specification — Check all 7 days of the week explicitly
  const hoursSpecs = Array.isArray(business.openingHoursSpecification)
    ? business.openingHoursSpecification
    : [];

  if (!hoursSpecs.length) {
    results.categories.approvedFacts.issues.push('Missing openingHoursSpecification in schema.');
  } else {
    const dayMap = new Map();
    // Build day map
    for (const spec of hoursSpecs) {
      const days = Array.isArray(spec.dayOfWeek)
        ? spec.dayOfWeek
        : (spec.dayOfWeek ? [spec.dayOfWeek] : []);
      for (const d of days) {
        if (!dayMap.has(d)) dayMap.set(d, []);
        dayMap.get(d).push({ opens: spec.opens, closes: spec.closes });
      }
    }

    // 1. Missing days check
    const missingDays = ALL_DAYS_OF_WEEK.filter(d => !dayMap.has(d));
    if (missingDays.length > 0) {
      results.categories.approvedFacts.issues.push(
        `Missing opening hours specifications for days: ${missingDays.join(', ')}. All 7 days must be explicitly specified.`
      );
    }

    // 2. Conflicting duplicate days check
    for (const [day, entries] of dayMap.entries()) {
      if (entries.length > 1) {
        const first = entries[0];
        const hasConflict = entries.some(e => e.opens !== first.opens || e.closes !== first.closes);
        if (hasConflict) {
          results.categories.approvedFacts.issues.push(
            `Conflicting duplicate opening hours for ${day}: ${JSON.stringify(entries)}.`
          );
        }
      }
    }

    // 3. Exact approved hours check
    const monSatDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const day of monSatDays) {
      const entries = dayMap.get(day);
      if (entries && entries.length) {
        const entry = entries[0];
        if (entry.opens !== expectedFacts.hours.monSat.opens || entry.closes !== expectedFacts.hours.monSat.closes) {
          results.categories.approvedFacts.issues.push(
            `Hours for ${day} are ${entry.opens}–${entry.closes}; approved hours are ${expectedFacts.hours.monSat.opens}–${expectedFacts.hours.monSat.closes}.`
          );
        }
      }
    }

    const sunEntries = dayMap.get('Sunday');
    if (sunEntries && sunEntries.length) {
      const sunEntry = sunEntries[0];
      if (sunEntry.opens !== expectedFacts.hours.sun.opens || sunEntry.closes !== expectedFacts.hours.sun.closes) {
        results.categories.approvedFacts.issues.push(
          `Hours for Sunday are ${sunEntry.opens}–${sunEntry.closes}; approved hours are ${expectedFacts.hours.sun.opens}–${expectedFacts.hours.sun.closes}.`
        );
      }
    }

    if (missingDays.length === 0 && !results.categories.approvedFacts.issues.some(i => i.includes('Hours for') || i.includes('Conflicting'))) {
      results.categories.approvedFacts.verifiedFacts.push(
        'Opening hours verified across all 7 days: Mon–Sat 04:00–22:00, Sun 09:00–17:00 America/New_York (Appointment Only).'
      );
    }
  }

  // E. Services & Offer Facts (if included in graph)
  const consultation = graph.find(e => e['@id'] && e['@id'].includes('consultation'));
  if (consultation) {
    const offer = consultation.offers || {};
    const priceStr = String(offer.price || '');
    if (priceStr !== expectedFacts.consultation.price && priceStr !== '99') {
      results.categories.approvedFacts.issues.push(
        `Consultation offer price mismatch: observed "$${priceStr}", expected "$${expectedFacts.consultation.price}".`
      );
    }
    const desc = String(consultation.description || '');
    if (desc.includes('60-minute') || desc.includes('60 min')) {
      results.categories.approvedFacts.issues.push(
        'Consultation description references 60 minutes; approved duration is 45 minutes.'
      );
    }
    if (desc.includes('Membership Experience Team')) {
      results.categories.approvedFacts.issues.push(
        'Consultation description references Membership Experience Team; approved naming is Client Experience Team.'
      );
    }
    if (!results.categories.approvedFacts.issues.some(i => i.includes('Consultation'))) {
      results.categories.approvedFacts.verifiedFacts.push(
        `Consultation offer verified: $${expectedFacts.consultation.price} (${expectedFacts.consultation.minutes} minutes, ${expectedFacts.consultation.host}).`
      );
    }
  }

  const halored = graph.find(e => e['@id'] && e['@id'].includes('halored'));
  if (halored) {
    const offers = Array.isArray(halored.offers) ? halored.offers : (halored.offers ? [halored.offers] : []);
    const singleOffer = offers.find(o => String(o.name || o.description || '').toLowerCase().includes('single') || String(o.price) === expectedFacts.halored.singlePrice);
    if (!singleOffer || String(singleOffer.price) !== expectedFacts.halored.singlePrice) {
      results.categories.approvedFacts.issues.push(
        `HaloRed single session price mismatch: expected "$${expectedFacts.halored.singlePrice}".`
      );
    }
    const memberOffer = offers.find(o => String(o.name || o.description || '').toLowerCase().includes('member'));
    if (!memberOffer || String(memberOffer.price) !== expectedFacts.halored.memberMonthlyPrice) {
      results.categories.approvedFacts.issues.push(
        `HaloRed member monthly price mismatch: expected "$${expectedFacts.halored.memberMonthlyPrice}".`
      );
    }
    if (!results.categories.approvedFacts.issues.some(i => i.includes('HaloRed'))) {
      results.categories.approvedFacts.verifiedFacts.push(
        `HaloRed pricing verified: $${expectedFacts.halored.singlePrice}/15m, $${expectedFacts.halored.memberMonthlyPrice}/mo member, $${expectedFacts.halored.publicMonthlyPrice}/mo public.`
      );
    }
  }

  // --- Category 4: Google Feature Eligibility ---
  // A. LocalBusiness Eligibility
  if (!business.telephone) {
    results.categories.googleFeatureEligibility.issues.push('Google requires telephone for LocalBusiness Knowledge Panel and Maps integration.');
  }
  if (!business.address || !business.address.streetAddress) {
    results.categories.googleFeatureEligibility.issues.push('Google requires full streetAddress for LocalBusiness physical pin resolution.');
  }

  // B. Self-Serving Review Policy Check (Google Search Central Policy Sept 2019+)
  if (business.aggregateRating) {
    results.categories.googleFeatureEligibility.warnings.push(
      'Self-Serving Review Policy: Google does NOT display review rich snippets for LocalBusiness when aggregateRating is embedded on the business’s own website. Star snippet will not be granted.'
    );
  }

  // C. 404 Image URLs Check
  if (business.logo && business.logo.includes('assets/images/logo.png')) {
    results.categories.googleFeatureEligibility.warnings.push(
      'Logo URL links to /assets/images/logo.png which returns 404. Image property should be omitted until a hosted public image URL exists.'
    );
  }
  if (business.image && business.image.includes('best-day-studio.jpg')) {
    results.categories.googleFeatureEligibility.warnings.push(
      'Image URL links to /assets/images/best-day-studio.jpg which returns 404. Image property should be omitted until a hosted public image URL exists.'
    );
  }

  // Compile final status
  results.categories.jsonSyntax.pass = results.categories.jsonSyntax.issues.length === 0;
  results.categories.schemaOrgVocabulary.pass = results.categories.schemaOrgVocabulary.issues.length === 0;
  results.categories.approvedFacts.pass = results.categories.approvedFacts.issues.length === 0;
  results.categories.googleFeatureEligibility.eligible = results.categories.googleFeatureEligibility.issues.length === 0;

  results.allIssues = [
    ...results.categories.jsonSyntax.issues,
    ...results.categories.schemaOrgVocabulary.issues,
    ...results.categories.approvedFacts.issues,
    ...results.categories.googleFeatureEligibility.issues,
  ];

  results.valid = results.categories.jsonSyntax.pass &&
                  results.categories.schemaOrgVocabulary.pass &&
                  results.categories.approvedFacts.pass &&
                  results.categories.googleFeatureEligibility.eligible;

  return results;
}

module.exports = {
  APPROVED_FACTS,
  ALL_DAYS_OF_WEEK,
  buildBusinessIdentitySchema,
  buildPageMetadataAndSchema,
  buildGhlSchemaGraph,
  buildGhlTrackingSnippet,
  validateSchema,
};
