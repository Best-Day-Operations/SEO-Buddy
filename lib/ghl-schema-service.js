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
    memberMonthlyPrice: '299.00',
    publicMonthlyPrice: '399.00',
    serviceHours: 'Daily 09:00–17:00 Eastern',
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
  }),
  socials: Object.freeze([
    'https://www.facebook.com/bestdayfitness',
    'https://www.instagram.com/best_day_fitness/',
    'https://www.youtube.com/c/Bestdayfitness',
  ]),
});

function buildGhlSchemaGraph(options = {}) {
  const domain = (options.domain || 'https://bestdayfitness.com').replace(/\/$/, '');
  const facts = options.facts || APPROVED_FACTS;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['HealthClub', 'ExerciseGym', 'SportsActivityLocation'],
        '@id': `${domain}/#business`,
        name: facts.name,
        legalName: facts.legalName,
        url: `${domain}/`,
        logo: `${domain}/assets/images/logo.png`,
        image: `${domain}/assets/images/best-day-studio.jpg`,
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
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: facts.reviews.rating,
          reviewCount: facts.reviews.count,
          bestRating: '5',
          worstRating: '1',
        },
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
      },
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
        description: `Private recovery booth combining dry salt aerosol halotherapy and full-body red and near-infrared light therapy. Base ${facts.halored.singleMinutes}-minute sessions with optional additional minutes up to 30 minutes total. Dedicated recovery service hours ${facts.halored.serviceHours}, subject to availability.`,
        provider: { '@id': `${domain}/#business` },
        areaServed: { '@type': 'City', name: 'St. Petersburg, FL' },
        offers: [
          {
            '@type': 'Offer',
            name: 'Single 15-Minute Session',
            price: facts.halored.singlePrice,
            priceCurrency: 'USD',
            description: `$${facts.halored.singlePrice} for base 15-minute session; $2.00 per additional minute up to 30 minutes total.`,
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
    ],
  };
}

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
<meta property="og:image" content="${domain}/assets/images/best-day-studio.jpg">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Best Day Fitness &amp; Wellness | St. Petersburg, FL">
<meta name="twitter:description" content="Personal training, physical therapy, HaloRed recovery, and wellness coaching for adults 50+ in St. Petersburg, FL.">
<meta name="twitter:image" content="${domain}/assets/images/best-day-studio.jpg">

<script type="application/ld+json">
${JSON.stringify(schemaGraph, null, 2)}
</script>`;
}

function validateSchema(schema) {
  const issues = [];
  if (!schema || typeof schema !== 'object') {
    return { valid: false, issues: ['Schema must be an object'] };
  }
  if (schema['@context'] !== 'https://schema.org') {
    issues.push('@context must be https://schema.org');
  }
  const graph = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
  const business = graph.find(e => {
    const types = Array.isArray(e['@type']) ? e['@type'] : [e['@type']];
    return types.some(t => ['HealthClub', 'ExerciseGym', 'SportsActivityLocation', 'SportsClub', 'LocalBusiness'].includes(t));
  });
  if (!business) {
    issues.push('Missing primary HealthClub/LocalBusiness entity');
  } else {
    if (!business.name) issues.push('Business name is required');
    if (!business.telephone) issues.push('Telephone is required');
    if (!business.address || !business.address.streetAddress) issues.push('Valid PostalAddress is required');
    if (!Array.isArray(business.openingHoursSpecification) || business.openingHoursSpecification.length === 0) {
      issues.push('OpeningHoursSpecification is required');
    } else {
      const monSat = business.openingHoursSpecification.find(h =>
        Array.isArray(h.dayOfWeek) && h.dayOfWeek.includes('Monday') && h.dayOfWeek.includes('Saturday')
      );
      if (!monSat || monSat.opens !== '04:00' || monSat.closes !== '22:00') {
        issues.push('Mon-Sat hours must be 04:00 to 22:00 per approved facts');
      }
      const sun = business.openingHoursSpecification.find(h =>
        Array.isArray(h.dayOfWeek) && h.dayOfWeek.includes('Sunday')
      );
      if (!sun || sun.opens !== '09:00' || sun.closes !== '17:00') {
        issues.push('Sunday hours must be 09:00 to 17:00 per approved facts');
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

module.exports = {
  APPROVED_FACTS,
  buildGhlSchemaGraph,
  buildGhlTrackingSnippet,
  validateSchema,
};
