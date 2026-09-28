// Turns raw Zoho Recruit Candidates + Applications into compact, normalized
// records the dashboard can filter and aggregate. Contact details (email,
// phone) are intentionally dropped here and never sent to the browser.

const FOREIGN = [
  ['Nepal', /\bnepal\b|kathmandu/],
  ['United States', /\busa\b|united states|\bamerica\b|new york|california|texas/],
  ['United Arab Emirates', /\buae\b|dubai|abu dhabi|sharjah|emirates/],
  ['United Kingdom', /\buk\b|united kingdom|london|england/],
  ['Canada', /canada|toronto|vancouver|brampton|ontario/],
  ['Australia', /australia|sydney|melbourne/],
  ['Bangladesh', /bangladesh|dhaka/],
  ['Pakistan', /pakistan|lahore|karachi/],
  ['Nigeria', /nigeria|lagos/],
  ['Philippines', /philippines|manila/],
  ['Singapore', /singapore/],
  ['Germany', /germany|berlin|munich/],
  ['Saudi Arabia', /saudi|riyadh|jeddah/],
  ['Qatar', /qatar|doha/],
  ['Turkey', /turkey|türkiye|istanbul|ankara/],
];

// Indian states/UTs with common spellings, then frequent cities -> state.
const STATES = [
  ['Punjab', /punjab|mohali|kharar|kharrar|zirakpur|ludhiana|ludhianna|gharuan|jalandhar|patiala|rajpura|amritsar|bathinda|ropar|roopnagar|rupnagar|fatehgarh|fathegarh|s\.?a\.?s\.? nagar|sahibzada ajit singh|hoshiarpur|hoshiyarpur|khanna|dera ?bassi|dera ?basi|derabassi|dehrabassi|mansa|pathankot|patankhot|kurali|banur|anandpur|gurdaspur|balongi|belongi|sangrur|faridkot|morinda|abohar|nangal|landran|landra|ferozpur|firozpur|phagwara|nawanshahr|nawasher|moga|muktsar|barnala|kapurthala|tarn taran|sirhind|mullanpur|new chandigarh|sunny enclave/],
  ['Chandigarh', /chandigarh|\bchd\b|manimajra|maloya|nayagaon|burail|dhanas/],
  ['Himachal Pradesh', /himachal|\bhp\b|shimla|kangra|una\b|solan|hamirpur|bilaspur|baddi|mandi\b|kullu|manali|chamba|dharamshala|dharamsala|nalagarh|sirmaur|nahan|palampur/],
  ['Haryana', /haryana|ambala|barara|panchkula|pinjore|kalka|karnal|gurgaon|gurugram|yamuna ?nagar|yumnanagar|yamunagar|panipat|kaithal|kurukshetra|kurekshatra|hisar|sirsa|rohtak|sonipat|faridabad|jind|bhiwani|rewari/],
  ['Delhi', /delhi|dwarka|rohini|janakpuri/],
  ['Uttar Pradesh', /uttar ?pradesh|\bup\b|bijnor|noida|lucknow|kanpur|saharanpur|meerut|varanasi|ghaziabad|agra|prayagraj|allahabad|gorakhpur|bareilly|aligarh|moradabad|muzaffarnagar/],
  ['Uttarakhand', /uttarakhand|uttarkhand|uttaranchal|dehradun|dheradun|haridwar|rishikesh|haldwani|roorkee/],
  ['Rajasthan', /rajasthan|jaipur|jodhpur|udaipur|kota|ajmer|bikaner|sri ganganagar/],
  ['Jammu & Kashmir', /jammu|kashmir|srinagar|kathua/],
  ['Bihar', /bihar|patna|gaya|muzaffarpur|bhagalpur|darbhanga/],
  ['Madhya Pradesh', /madhya pradesh|\bmp\b|\brewa\b|indore|bhopal|gwalior|jabalpur/],
  ['Maharashtra', /maharashtra|mumbai|virar|kolhapur|pune|nagpur|thane|nashik|navi mumbai/],
  ['Karnataka', /karnataka|bangalore|banglore|bengaluru|mysore|mangalore/],
  ['Telangana', /telangana|hyderabad|secunderabad/],
  ['Tamil Nadu', /tamil ?nadu|chennai|coimbatore|madurai/],
  ['Kerala', /kerala|kochi|alappuzha|cochin|trivandrum|thiruvananthapuram|kozhikode/],
  ['West Bengal', /west bengal|kolkata|calcutta|howrah|siliguri/],
  ['Andhra Pradesh', /andhra|andhara|kadapa|visakhapatnam|vijayawada|guntur/],
  ['Jharkhand', /jharkhand|ranchi|jamshedpur|dhanbad/],
  ['Gujarat', /gujarat|ahmedabad|surat|vadodara|rajkot/],
  ['Odisha', /odisha|odissa|orissa|bhubaneswar|cuttack/],
  ['Assam', /assam|guwahati/],
  ['Chhattisgarh', /chhattisgarh|chattisgarh|raipur|bilai|bhilai/],
];

const STATE_NAMES = /^(india|in|punjab|haryana|himachal( pradesh)?|hp|uttar ?pradesh|up|madhya pradesh|mp|andhra pradesh|arunachal pradesh|jammu (and|&) kashmir|kashmir|bihar|rajasthan|kerala|assam|gujarat|odisha|uttarakhand|jharkhand|chhattisgarh|maharashtra|karnataka|telangana|tamil ?nadu|west bengal|goa)$/i;

const JUNK_LOCATION = /^(not available|na|n\/a|nil|none|-|\.|place:?|12th pass)$/i;

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function classifyLocation(raw) {
  const text = (raw || '').trim();
  if (!text || JUNK_LOCATION.test(text)) return { city: 'Not specified', state: 'Not specified', country: 'Not specified' };
  const lower = text.toLowerCase();
  let city = titleCase(text.split(/[,(\-/]/)[0].trim().replace(/\s+/g, ' ')) || 'Not specified';
  // A bare state or country name ("Punjab", "Himachal Pradesh", "India") is not a city.
  if (STATE_NAMES.test(city)) city = 'Not specified';
  for (const [country, re] of FOREIGN) if (re.test(lower)) return { city, state: 'Outside India', country };
  // US-style "City, ST 12345" addresses.
  if (/,\s*[A-Z]{2}\s+\d{5}\b/.test(text)) return { city, state: 'Outside India', country: 'United States' };
  // Free-text locations in this org are overwhelmingly Indian localities;
  // anything that is not a recognised foreign place is attributed to India.
  const state = STATES.find(([, re]) => re.test(lower))?.[0] || 'Other / unmapped';
  return { city, state, country: 'India' };
}

const SOURCE_GROUPS = [
  ['Indeed', /indeed/i],
  ['Career site', /career|candidate portal/i],
  ['Resume inbox', /resume inbox|imported by parser/i],
  ['Job boards', /apna|naukri|linkedin|internshala|facebook|monster|shine/i],
  ['Referrals & partners', /refer|reference|consultant|relationship manager|tpo/i],
  ['Walk-in & calls', /walk|call|standee|whatsapp|advertisement/i],
];

function sourceGroup(source) {
  if (!source) return 'Not specified';
  return SOURCE_GROUPS.find(([, re]) => re.test(source))?.[0] || 'Other';
}

// "Fresher", "6 M", "1.5 Yr", "> 5 Yrs", "3 Years", "2" -> years (number) or null.
function parseExperience(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith('fresher')) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(n)) return null;
  if (/\bm\b|month/.test(s)) return n / 12;
  if (s.startsWith('>')) return n + 0.5;
  return n > 45 ? null : n;
}

export const EXP_BANDS = ['Fresher', '< 1 yr', '1–2 yrs', '2–3 yrs', '3–5 yrs', '5–10 yrs', '10+ yrs', 'Not specified'];
function expBand(y) {
  if (y == null) return 'Not specified';
  if (y === 0) return 'Fresher';
  if (y < 1) return '< 1 yr';
  if (y < 2) return '1–2 yrs';
  if (y < 3) return '2–3 yrs';
  if (y < 5) return '3–5 yrs';
  if (y < 10) return '5–10 yrs';
  return '10+ yrs';
}

export const AGE_BANDS = ['≤ 20', '21–23', '24–26', '27–30', '31–35', '36–40', '41+', 'Not specified'];
function ageBand(a) {
  if (a == null) return 'Not specified';
  if (a <= 20) return '≤ 20';
  if (a <= 23) return '21–23';
  if (a <= 26) return '24–26';
  if (a <= 30) return '27–30';
  if (a <= 35) return '31–35';
  if (a <= 40) return '36–40';
  return '41+';
}

function gender(salutation) {
  const s = (salutation || '').toLowerCase().replace('.', '');
  if (s === 'mr') return 'Male';
  if (['ms', 'mrs', 'miss'].includes(s)) return 'Female';
  return 'Not specified';
}

// Selection outcome from the org's custom result fields, most decisive first.
function outcome(c, apps) {
  if (c.Final_Status === 'Selected') return 'Selected';
  if (c.Final_Status === 'Not Selected') return 'Rejected';
  if (c.Hiring_Result === 'Selected') return 'Selected';
  if (c.HR_Result === 'Rejected') return 'Rejected';
  if (c.HR_Result === 'On Hold') return 'On hold';
  if (c.HR_Result === 'Selected') return 'Selected';
  if (c.Technical_Status === 'Selected') return 'Selected';
  if (apps.some((a) => a.GK_Sir_Approval === 'Selected')) return 'Selected';
  if (['Offered', 'Hired'].includes(c.Candidate_Stage)) return 'Selected';
  return 'No decision';
}

// Ordered funnel. Each candidate is counted at the furthest step they reached.
// Bump when the record shape changes, so the page can detect an outdated server.
export const SCHEMA_VERSION = 2;

export const FUNNEL = ['Sourced', 'Engaged', 'Applied to a job', 'Screened / assessed', 'Interviewed', 'Selected', 'Offered / hired'];

const day = (v) => (v ? String(v).slice(0, 10) : null);

export function buildDataset(candidates, applications, jobOpenings) {
  const appsByCandidate = new Map();
  for (const a of applications) {
    const id = a.$Candidate_Id;
    if (!id) continue;
    if (!appsByCandidate.has(id)) appsByCandidate.set(id, []);
    appsByCandidate.get(id).push(a);
  }

  const records = candidates.map((c) => {
    const apps = appsByCandidate.get(c.id) || [];
    const loc = classifyLocation(c.Current_Location || c.Hometown_Location);
    const exp = parseExperience(c.Work_Exp);
    const ageNum = c.Age_Yrs != null && c.Age_Yrs !== '' ? Number(c.Age_Yrs) : null;
    const age = ageNum && ageNum >= 15 && ageNum <= 70 ? ageNum : null;
    const result = outcome(c, apps);
    const appStatuses = apps.map((a) => a.Application_Status).filter(Boolean);
    const hired = c.Candidate_Stage === 'Hired' || c.Candidate_Status === 'Forward-to-Onboarding'
      || appStatuses.includes('Hired') || apps.some((a) => a.Date_Hired);

    const flags = [
      true,
      c.Candidate_Stage !== 'New' || apps.length > 0,
      apps.length > 0,
      Boolean(c.Assessment_Status || c.Assessment_Result || c.Technical_Status || c.Technical_Round_Date || appStatuses.includes('Qualified')),
      Boolean(c.HR_Round_Date || c.Interview_Schedule_Date || c.HR_Result || c.Hiring_Result || appStatuses.includes('Interview-Scheduled')),
      result === 'Selected',
      hired || c.Candidate_Stage === 'Offered',
    ];
    const level = flags.lastIndexOf(true);

    const decisionDate = day(apps.find((a) => a.Date_Hired)?.Date_Hired)
      || day(c.HR_Round_Date) || day(c.Technical_Round_Date) || day(c.Assessment_Date) || day(c.Updated_On);

    return {
      id: c.id,
      code: c.Candidate_ID,
      name: (c.Full_Name || [c.First_Name, c.Last_Name].filter(Boolean).join(' ')).trim() || '(no name)',
      created: day(c.Created_Time),
      updated: day(c.Updated_On),
      lastActivity: day(c.Last_Activity_Time),
      stage: c.Candidate_Stage || 'Not specified',
      status: c.Candidate_Status || 'Not specified',
      source: c.Source || 'Not specified',
      sourceGroup: sourceGroup(c.Source),
      origin: c.Origin || 'Not specified',
      owner: c.Candidate_Owner?.name || 'Unassigned',
      department: c.Departments || 'Not specified',
      role: c.Current_Job_Role || null,
      location: c.Current_Location || c.Hometown_Location || null,
      city: loc.city,
      state: loc.state,
      country: loc.country,
      gender: gender(c.Salutation),
      age,
      ageBand: ageBand(age),
      expYears: exp,
      expBand: expBand(exp),
      jobs: apps.length ? [...new Set(apps.map((a) => (a.Posting_Title || a.Job_Opening_Name?.name || a.Job_Opening_Name || 'Unknown').trim()))] : ['No job applied'],
      appStatuses,
      applications: apps.length,
      outcome: result,
      hired,
      level,
      decisionDate: result === 'Selected' || hired ? decisionDate : null,
      resume: Boolean(c.Is_Attachment_Present),
      inviteStatus: c.Career_Page_Invite_Status || 'Not specified',
      createdTime: c.Created_Time || null,
      salutation: c.Salutation || 'Not specified',
      tags: (c.Associated_Tags || []).map((t) => t.name).filter(Boolean),
      appStatus: appStatuses.length ? appStatuses[appStatuses.length - 1] : 'No application',
      // Call
      callStatus: c.Call_Status && c.Call_Status !== 'None' ? c.Call_Status : (c.Call_Checkbox ? 'Called (no status)' : 'Not called yet'),
      callDate: day(c.Call_Date),
      callRemarks: c.Remarks || null,
      // Rounds
      assessmentStatus: c.Assessment_Status || 'Not started',
      assessmentResult: c.Assessment_Result === 'Passed' ? 'Pass' : (c.Assessment_Result || 'Not recorded'),
      assessmentScore: c.Assessment_Score != null ? Number(c.Assessment_Score) : null,
      assessmentDate: day(c.Assessment_Date),
      technicalStatus: c.Technical_Status || 'Not started',
      technicalRating: c.Technical_Rating != null ? Number(c.Technical_Rating) : null,
      technicalDate: day(c.Technical_Round_Date),
      hrResult: c.HR_Result || 'Not recorded',
      hrDate: day(c.HR_Round_Date),
      interviewDate: day(c.Interview_Schedule_Date),
      testAssignedTo: c.Test_Assignment || 'Not assigned',
      assignedTo: c.Assigned_To1 || 'Not assigned',
      // Final
      hiringResult: c.Hiring_Result || 'Not recorded',
      finalStatus: c.Final_Status || 'Not recorded',
      confirmedBy: c.Confirmation1 || 'Not recorded',
    };
  });

  const jobs = jobOpenings.map((j) => ({
    id: j.id,
    title: (j.Posting_Title || j.Job_Opening_Name || '').trim(),
    status: j.Job_Opening_Status,
    opened: j.Date_Opened,
    positions: Number(j.Number_of_Positions) || 0,
    associated: j.No_of_Candidates_Associated || 0,
    hired: j.No_of_Candidates_Hired || 0,
    city: j.City,
    country: j.Country,
    type: j.Job_Type,
  }));

  return { schema: SCHEMA_VERSION, records, jobs, funnel: FUNNEL, expBands: EXP_BANDS, ageBands: AGE_BANDS };
}
