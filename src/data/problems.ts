/**
 * The 100 problems. Every problem uses the same layouts; only the data differs.
 *
 * To open a problem for reports, add its number to ACTIVE_PROBLEMS and create
 * the folder reports/<slug>/ (the slug is printed on the problem page and in
 * README.md). Nothing else changes.
 */
export const ACTIVE_PROBLEMS: number[] = [11];

export interface ProblemSeed {
  number: number;
  category: string;
  title: string;
  /** Optional short name used in the URL. Defaults to a slug of the title. */
  short?: string;
}

export interface Problem extends ProblemSeed {
  slug: string;
  active: boolean;
}

const SEEDS: ProblemSeed[] = [
  { number: 1, category: "Health", title: "Cut deaths from drug-resistant infections by 90%, with a new class of antibiotics reaching patients every year" },
  { number: 2, category: "Health", title: "Reduce malaria deaths to zero in every country" },
  { number: 3, category: "Health", title: "Cut tuberculosis deaths by 95% and new cases by 90%" },
  { number: 4, category: "Health", title: "Halve the number of people developing dementia, and stop its progression in those who have it" },
  { number: 5, category: "Health", title: "Detect 90% of cancers at stage 1 or 2" },
  { number: 6, category: "Health", title: "Deliver an approved vaccine for any new pandemic within 100 days of the first case" },
  { number: 7, category: "Health", title: "Get effective treatment to 80% of people with depression or anxiety" },
  { number: 8, category: "Health", title: "Give 95% of people access to safe, affordable surgery within two hours of home" },
  { number: 9, category: "Health", title: "Bring maternal deaths below 70 per 100,000 births, and newborn deaths below 12 per 1,000, in every country" },
  { number: 10, category: "Health", title: "Add 10 healthy years to the average human life" },
  { number: 11, category: "Climate & energy", title: "Generate 100% of the world's electricity from clean sources" },
  { number: 12, category: "Climate & energy", title: "Bring long-duration energy storage below $20 per kWh" },
  { number: 13, category: "Climate & energy", title: "Produce 100% of the world's steel and cement with near-zero emissions" },
  { number: 14, category: "Climate & energy", title: "Remove 10 billion tonnes of CO₂ from the air every year at under $100 per tonne" },
  { number: 15, category: "Climate & energy", title: "Cut human-caused methane emissions by 75%" },
  { number: 16, category: "Climate & energy", title: "Run 100% of flights and cargo shipping on zero-carbon fuels" },
  { number: 17, category: "Climate & energy", title: "Connect 100% of homes to reliable electricity" },
  { number: 18, category: "Climate & energy", title: "Give 100% of households clean cooking" },
  { number: 19, category: "Climate & energy", title: "Get every community on a funded adaptation plan, with heat and flood deaths cut by 90%" },
  { number: 20, category: "Climate & energy", title: "Bring a clean, always-on power source to commercial scale at a cost below fossil fuels" },
  { number: 21, category: "Food, water & land", title: "Feed 10 billion people well, without converting a single extra hectare of forest to farmland" },
  { number: 22, category: "Food, water & land", title: "Bring hunger to zero and cut child stunting below 5% in every country" },
  { number: 23, category: "Food, water & land", title: "Bring 100% of major aquifers to sustainable use" },
  { number: 24, category: "Food, water & land", title: "Give 100% of people safe drinking water at home" },
  { number: 25, category: "Food, water & land", title: "Give 100% of people a safe toilet" },
  { number: 26, category: "Food, water & land", title: "Restore 1 billion hectares of degraded land" },
  { number: 27, category: "Food, water & land", title: "Halve global food loss and waste" },
  { number: 28, category: "Food, water & land", title: "Raise yields of the 10 major staple crops by 50% under drought and heat" },
  { number: 29, category: "Food, water & land", title: "Halve nitrogen pollution from farming" },
  { number: 30, category: "Food, water & land", title: "Make sustainable proteins cheaper than meat and 50% of the protein people eat" },
  { number: 31, category: "Nature", title: "Bring tropical deforestation to zero" },
  { number: 32, category: "Nature", title: "Halt all human-caused extinctions and protect 30% of land and sea" },
  { number: 33, category: "Nature", title: "Restore 50% of the world's lost coral reefs" },
  { number: 34, category: "Nature", title: "Bring 100% of fish stocks to sustainable levels" },
  { number: 35, category: "Nature", title: "Stop 100% of plastic from leaking into nature" },
  { number: 36, category: "Nature", title: "Meet WHO clean air standards for 100% of the world's people" },
  { number: 37, category: "Nature", title: "Phase out 100% of non-essential forever chemicals and clean up the worst-contaminated sites" },
  { number: 38, category: "Nature", title: "Reverse pollinator decline in every major farming region" },
  { number: 39, category: "Nature", title: "Eradicate invasive species from 1,000 of the most threatened islands" },
  { number: 40, category: "Nature", title: "Halve the area burned by uncontrolled wildfires" },
  { number: 41, category: "Money & work", title: "Bring extreme poverty to zero" },
  { number: 42, category: "Money & work", title: "Give 100% of adults access to a bank account, credit, and insurance" },
  { number: 43, category: "Money & work", title: "Make housing cost no more than 30% of income for 90% of households" },
  { number: 44, category: "Money & work", title: "Get 90% of young people into work, education, or training" },
  { number: 45, category: "Money & work", title: "Retrain 1 billion workers for AI-era jobs, with net job growth in every economy" },
  { number: 46, category: "Money & work", title: "Make children's life outcomes independent of their parents' income" },
  { number: 47, category: "Money & work", title: "Give 100% of workers basic social protection" },
  { number: 48, category: "Money & work", title: "Cap debt payments at 10% of government revenue in every low-income country" },
  { number: 49, category: "Money & work", title: "Double the productivity growth rate of advanced economies" },
  { number: 50, category: "Money & work", title: "Provide 100% of older people with a pension and affordable care" },
  { number: 51, category: "Learning & knowledge", title: "Make sure 95% of 10-year-olds can read a simple story" },
  { number: 52, category: "Learning & knowledge", title: "Get 100% of children through primary and lower secondary school" },
  { number: 53, category: "Learning & knowledge", title: "Give 1 billion learners a free AI tutor that doubles their learning speed" },
  { number: 54, category: "Learning & knowledge", title: "Make sure 100% of adults can access affordable, recognized retraining" },
  { number: 55, category: "Learning & knowledge", title: "Halve the reach of viral misinformation on major platforms" },
  { number: 56, category: "Learning & knowledge", title: "Raise the share of replicable published studies above 90%" },
  { number: 57, category: "Learning & knowledge", title: "Cut the time from research grant to published result by 75%" },
  { number: 58, category: "Learning & knowledge", title: "Get 100% of people online at affordable speeds" },
  { number: 59, category: "Learning & knowledge", title: "Make the world's top 1,000 knowledge sources available in every language with 1M+ speakers" },
  { number: 60, category: "Learning & knowledge", title: "Make sure 80% of top graduates in developing countries choose to build careers at home" },
  { number: 61, category: "Peace & government", title: "Halve the number of active wars and cut conflict deaths by 90%" },
  { number: 62, category: "Peace & government", title: "Cut global nuclear warheads by 90% and bring the risk of use to near zero" },
  { number: 63, category: "Peace & government", title: "Raise every country's corruption score above 50 out of 100" },
  { number: 64, category: "Peace & government", title: "Increase the number of people living in full democracies by 2 billion" },
  { number: 65, category: "Peace & government", title: "Rehouse 100% of displaced people safely, with legal status and the right to work" },
  { number: 66, category: "Peace & government", title: "Free all 50 million people in modern slavery" },
  { number: 67, category: "Peace & government", title: "Give 100% of people a legal ID and access to a fair court" },
  { number: 68, category: "Peace & government", title: "Create binding global agreements on the 10 biggest shared threats" },
  { number: 69, category: "Peace & government", title: "Cut successful cyberattacks on critical infrastructure by 90%" },
  { number: 70, category: "Peace & government", title: "Raise trust between opposing political groups by 50%" },
  { number: 71, category: "Cities & infrastructure", title: "Cut road deaths by 90%" },
  { number: 72, category: "Cities & infrastructure", title: "Upgrade 100% of slums to safe housing with water, power, and sanitation" },
  { number: 73, category: "Cities & infrastructure", title: "Close the global infrastructure gap in water, power, and transport" },
  { number: 74, category: "Cities & infrastructure", title: "Build 300 million affordable, net-zero homes" },
  { number: 75, category: "Cities & infrastructure", title: "Recycle 90% of critical minerals and certify 100% of new mining as responsible" },
  { number: 76, category: "Cities & infrastructure", title: "Recycle 90% of electronic waste" },
  { number: 77, category: "Cities & infrastructure", title: "Cut deaths from urban heat by 90%" },
  { number: 78, category: "Cities & infrastructure", title: "Put high-quality public transit within 500 metres of 90% of city dwellers" },
  { number: 79, category: "Cities & infrastructure", title: "Make sure no single disruption can cut supply of any essential good by more than 10%" },
  { number: 80, category: "Cities & infrastructure", title: "Give 100% of people early warning of disasters" },
  { number: 81, category: "Technology & big risks", title: "Make sure every frontier AI system passes independent safety evaluation before release" },
  { number: 82, category: "Technology & big risks", title: "Establish an international body that oversees all frontier AI development" },
  { number: 83, category: "Technology & big risks", title: "Screen 100% of DNA synthesis orders and detect any new outbreak within one week" },
  { number: 84, category: "Technology & big risks", title: "Remove the 50 most dangerous pieces of space debris and make every new satellite remove itself after use" },
  { number: 85, category: "Technology & big risks", title: "Find 100% of asteroids large enough to destroy a city, with a proven way to deflect them" },
  { number: 86, category: "Technology & big risks", title: "Make every major power grid able to survive the worst recorded solar storm" },
  { number: 87, category: "Technology & big risks", title: "Move 100% of critical systems to quantum-safe encryption" },
  { number: 88, category: "Technology & big risks", title: "Make sure no single company or government controls more than a fair share of any critical technology" },
  { number: 89, category: "Technology & big risks", title: "Give every person legal control over their personal data" },
  { number: 90, category: "Technology & big risks", title: "Preserve 100% of humanity's significant digital records in formats readable for 1,000 years" },
  { number: 91, category: "The future & wellbeing", title: "Map every connection in the human brain and explain how it produces thought" },
  { number: 92, category: "The future & wellbeing", title: "Halve the share of people who report feeling lonely" },
  { number: 93, category: "The future & wellbeing", title: "Cut overdose deaths by 90% and double addiction recovery rates" },
  { number: 94, category: "The future & wellbeing", title: "Eliminate all 20 neglected tropical diseases" },
  { number: 95, category: "The future & wellbeing", title: "Develop a treatment for 1,000 rare diseases that currently have none" },
  { number: 96, category: "The future & wellbeing", title: "Cut the time to develop a new drug from 10+ years to 2, and its cost by 90%" },
  { number: 97, category: "The future & wellbeing", title: "Discover 1,000 new materials with breakthrough properties using AI" },
  { number: 98, category: "The future & wellbeing", title: "Establish a permanent, self-sustaining human settlement beyond Earth" },
  { number: 99, category: "The future & wellbeing", title: "Map 100% of the seafloor and protect 30% of the deep ocean" },
  { number: 100, category: "The future & wellbeing", title: "Get 50 countries to officially measure success by citizens' wellbeing alongside GDP" },
];

// Short URL names for active problems. Add one when you activate a problem.
const SHORT: Record<number, string> = {
  11: 'clean-electricity',
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[₂]/g, '2')
    .replace(/%/g, '-percent')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
}

export const problems: Problem[] = SEEDS.map((p) => ({
  ...p,
  slug: `${String(p.number).padStart(2, '0')}-${SHORT[p.number] ?? slugify(p.title)}`,
  active: ACTIVE_PROBLEMS.includes(p.number),
}));

export const activeProblems = problems.filter((p) => p.active);

export const categories = [...new Set(problems.map((p) => p.category))];

export function getProblem(number: number): Problem | undefined {
  return problems.find((p) => p.number === number);
}
