// A stand-in for an OpenAI-compatible AI server (E11-2), started by
// playwright.config.ts. It answers each task by its JSON schema's name with
// plausible output built from the prompt, like the mock provider in the unit
// tests, so the app's real provider code runs end to end.

import { createServer } from "node:http";

type Message = { role: string; content: string };
type Request = { messages: Message[]; response_format?: { json_schema?: { name?: string } } };

const port = Number(process.env.FAKE_AI_PORT ?? 3999);

/** The JSON after `label` in a message, up to the next blank line and label. */
function section(text: string, label: string): unknown {
  const start = text.indexOf(label);
  if (start < 0) return null;
  const rest = text.slice(start + label.length);
  const end = rest.search(/\n\n[A-Z][^\n]*:\n/);
  return JSON.parse(end < 0 ? rest : rest.slice(0, end));
}

type Profile = {
  summary: string;
  skills: string[];
  experience: { id: string; bullets: string[] }[];
  projects: { id: string; bullets: string[] }[];
  education: { id: string; notes: string }[];
};
type Unit = { id: string; label: string; text: string };

/** Emails written so far, so writing again gives a different one. */
let emails = 0;
/** The last request's messages, for specs that check what a prompt carried (GET /last). */
let last: Message[] = [];

const answers: Record<string, (messages: Message[]) => unknown> = {
  extracted_posting: () => ({
    title: "Senior Product Designer, Payments · Ledgerly",
    company: "Ledgerly",
    role: "Senior Product Designer, Payments",
    location: "Amsterdam",
    mode: "Hybrid · 3 days in office",
    salary: "€75,000–€90,000",
    deadline: null,
    requirements: [
      { text: "5+ years of product design", kind: "years", skill: null, years: 5, language: null },
      { text: "Built or maintained a design system", kind: "skill", skill: "Design systems", years: null, language: null },
      { text: "Strong prototyping skills in Figma", kind: "skill", skill: "Figma", years: null, language: null },
      { text: "Experience with Kubernetes", kind: "skill", skill: "Kubernetes", years: null, language: null },
      { text: "Dutch is a plus", kind: "language", skill: null, years: null, language: "Dutch" },
    ],
    asksForReferences: false,
    language: "English",
  }),

  requirement_matches: (messages) => {
    const { requirements, candidateSkills, candidateLanguages } = JSON.parse(messages[1].content) as {
      requirements: { number: number; text: string; skill: string | null }[];
      candidateSkills: string[];
      candidateLanguages: string[];
    };
    return {
      matches: requirements.map((requirement) => ({
        requirement: requirement.number,
        skill: candidateSkills.find((name) => name.toLowerCase() === requirement.skill?.toLowerCase()) ?? null,
        language: candidateLanguages.find((name) => requirement.text.includes(name)) ?? null,
      })),
    };
  },

  tailored_resume: (messages) => {
    const profile = section(messages[1].content, "The candidate's profile:\n") as Profile;
    return {
      summary: profile.summary,
      roles: profile.experience.map((entry) => ({ id: entry.id, bullets: entry.bullets })),
      projects: profile.projects.map((entry) => ({ id: entry.id, bullets: entry.bullets })),
      skills: profile.skills,
      education: profile.education.map((entry) => ({ id: entry.id, notes: entry.notes })),
    };
  },

  // The job agent's score (E16): by the posting's title, so a spec knows
  // which postings make the queue (70 is the default minimum) and which don't.
  posting_score: (messages) => {
    const { title } = section(messages[1].content, "The posting's facts:\n") as { title: string };
    const score = /senior product designer/i.test(title) ? 91 : /product designer/i.test(title) ? 78 : 45;
    return {
      score,
      reasons: [score >= 70 ? `The profile's product design roles match "${title}".` : `"${title}" is further from the profile's roles.`],
      redFlags: score >= 70 ? [] : ["The profile shows no UX research lead role."],
    };
  },

  cover_letter: () => ({
    recipient: "Ledgerly · Hiring team\nAmsterdam",
    greeting: "Dear Ledgerly team,",
    paragraphs: [
      { label: "Opening", text: "Payments are where trust is won or lost, and I'd love to help Ledgerly's customers feel calm about them." },
      { label: "Experience", text: "At Northwind Logistics I led the design of complex operational tools, from research to shipped flows." },
      { label: "Closing", text: "I'd be glad to talk about how I could help your Payments team." },
    ],
    signOff: "Warm regards,",
  }),

  application_email: () => ({
    contactName: "John Doe",
    contactEmail: "careers@example.com",
    subject: "Application: Senior Product Designer, Payments",
    greeting: "Dear John,",
    paragraphs: [
      emails++ === 0
        ? "I'm applying for the Senior Product Designer role on your Payments team."
        : "I'd love to help Ledgerly's customers feel calm about their payments as your Senior Product Designer.",
      "I've designed complex operational tools end to end, from research to shipped flows.",
      "My resume and cover letter are attached. I'd be glad to talk.",
    ],
    signOff: "Warm regards,",
  }),

  refinement: (messages) => {
    const request = messages.at(-1)!.content;
    if (/kubernetes/i.test(request)) {
      return { reply: "Your profile doesn't mention Kubernetes, so I left it out. Add it to your profile first.", edits: [], tone: null, declined: true };
    }
    if (request.includes("(I'm looking at the email.)")) {
      const email = section(messages[1].content, "The email's units:\n") as Unit[];
      const body = email.find((unit) => unit.id === "body")!;
      // Without the middle paragraph.
      const shorter = body.text.split("\n\n").filter((_, index) => index !== 2).join("\n\n");
      return { reply: "Done. I made the email shorter.", edits: [{ document: "EMAIL", unitId: "body", text: shorter }], tone: null, declined: false };
    }
    const resume = section(messages[1].content, "The resume's units:\n") as Unit[];
    const summary = resume.find((unit) => unit.id === "summary")!;
    const shorter = summary.text.split(/(?<=\.)\s+/)[0];
    return { reply: "Done. I made the summary shorter.", edits: [{ document: "RESUME", unitId: "summary", text: shorter }], tone: null, declined: false };
  },

  extracted_profile: () => ({
    basics: {
      name: "John Doe",
      headline: "Design Lead",
      email: "robin@example.com",
      phone: null,
      dob: null,
      website: null,
      address: null,
      city: "Utrecht",
      country: null,
      linkedin: null,
      summary: null,
    },
    skills: ["Figma", "Service design"],
    languages: [{ name: "Dutch", level: "NATIVE" }],
    experience: [
      {
        role: "Design Lead",
        company: "Acme Payments",
        location: "Utrecht",
        descriptor: "Payouts for online marketplaces, 60 people",
        startYear: 2021,
        startMonth: 3,
        endYear: null,
        endMonth: null,
        current: true,
        bullets: ["Led the redesign of the payout flow"],
        skills: ["Service design"],
      },
    ],
    projects: [],
    education: [],
    publications: [],
    references: [],
  }),

  // Gmail (E15): an employer's reply is an invitation that asks two things,
  // and the answer offers the times it's given and leaves the notice period open.
  classified_reply: () => ({
    kind: "INTERVIEW",
    summary: "Invites you to a 45-minute call next week and asks about your notice period.",
    questions: ["Which times would work for you?", "What is your notice period?"],
    confirmedTime: null,
  }),

  reply_draft: (messages) => {
    const times = (messages.at(-1)?.content ?? "").split("\n").filter((line) => line.startsWith("• "));
    return {
      greeting: "Hi John,",
      paragraphs: [
        times.length > 0 ? `Thank you, I'd be glad to talk. Any of these times works for me:\n${times.join("\n")}` : "Thank you, I'd be glad to talk.",
        "My notice period is […].",
      ],
      signOff: "Best regards,",
      gaps: ["What is your notice period?"],
    };
  },

  // ─── Career Studio's agents ───────────────────────────────────────────────
  interview_plan: () => ({
    competencies: [
      { name: "Product judgement", why: "The role owns decisions end to end." },
      { name: "Collaboration", why: "Works daily with engineering and research." },
      { name: "Communication", why: "Presents to leadership." },
    ],
    firstQuestion: { competency: "Product judgement", question: "Tell me about a product decision you owned from start to finish. What made it hard?", lookingFor: "The problem, options weighed, the call and the result." },
  }),
  interview_turn: (messages) => {
    const asked = Number(/Main questions asked: (\d+) of (\d+)/.exec(messages.at(-1)?.content ?? "")?.[1] ?? 1);
    const target = Number(/Main questions asked: (\d+) of (\d+)/.exec(messages.at(-1)?.content ?? "")?.[2] ?? 3);
    const followUp = /\(follow-up,/.test(messages.at(-1)?.content ?? "");
    const action = asked >= target && followUp ? "end" : !followUp && asked % 2 === 1 ? "follow-up" : asked < target ? "question" : "end";
    return {
      feedback: {
        score: 3,
        summary: "A clear story, but the outcome and your own part in it stay vague.",
        strengths: ["You framed the user problem clearly", "You named the trade-off you made"],
        gaps: ["No measurable result", "Unclear what you did versus the team"],
        strongerAnswer: "At my last role I owned the redesign of onboarding. Drop-off at step two was [how high]. I tested three flows with five customers each, chose the shortest, and shipped it with engineering in [how many] weeks; drop-off fell to [the new figure].",
        missingFacts: ["The drop-off rate before and after", "How long it took to ship"],
      },
      next: action === "end" ? { action, competency: "", question: "", lookingFor: "" } : action === "follow-up"
        ? { action, competency: "Product judgement", question: "What would you have done differently if you'd had half the time?", lookingFor: "Prioritisation under pressure." }
        : { action, competency: "Collaboration", question: "Describe a disagreement with an engineer about scope. How did it end?", lookingFor: "Listening, a resolution, the relationship after." },
    };
  },
  interview_report: () => ({
    readiness: "You structure answers well; the main gap is evidence. Add one number and your own decision to each story and you'll be ready for this round.",
    competencies: [
      { competency: "Product judgement", score: 3.5, note: "Good framing, light on outcome." },
      { competency: "Collaboration", score: 3, note: "Fair, but say what you did." },
    ],
    strengths: ["Clear structure", "Honest about trade-offs"],
    recurringWeaknesses: ["Results without numbers", "\"We\" where it should be \"I\""],
    practiceNext: ["Prepare three stories with a before-and-after number", "Practise saying your own part in one sentence"],
  }),
  round_prep: () => ({
    focus: [{ area: "Ownership and impact", why: "A hiring manager judges whether you'd succeed on their team.", howToPrepare: "Pick two projects where you made the call, with the result." }],
    likelyQuestions: [{ question: "What's the hardest trade-off you've made recently?", why: "Tests judgement." }, { question: "How do you work with engineering on scope?", why: "Daily collaboration." }],
    stories: [{ story: "Your onboarding redesign", useFor: "Impact and ownership questions" }],
    questionsToAsk: ["What would success look like in the first six months?", "How are design decisions made on the team?"],
    carryForward: ["The recruiter asked about salary early: have your range ready."],
    tips: ["Keep answers under two minutes", "Bring one artefact to show"],
  }),
  upwork_analysis: () => ({
    summary: "A small Webflow build with a clear scope and a reasonable budget; a good fit for your design and build experience.",
    suitability: { score: 78, verdict: "pursue", evidence: ["Your Webflow projects match the stack", "Landing pages are in your profile"], gaps: ["No Lottie animation work shown"] },
    jobFacts: { budgetType: "fixed", statedBudget: "$1,200", duration: "1 to 3 months", experienceLevel: "Intermediate", clientSignals: ["Payment method verified", "5 hires"] },
    pricing: { type: "fixed", low: 1100, high: 1500, rationale: "Five sections with responsive layouts and a CMS collection take about 20 to 30 hours at your level.", assumptions: ["Copy and images are provided", "Two rounds of revisions"] },
    scope: { deliverables: ["Home page with five sections", "Blog CMS collection", "Responsive layouts"], effortHoursLow: 20, effortHoursHigh: 30, milestones: [{ title: "Design", deliverable: "Approved layouts", percent: 40 }, { title: "Build", deliverable: "Live site", percent: 60 }] },
    risks: ["Animations aren't specified"],
    missingInfo: ["Whether copy is final", "Hosting plan"],
    questionsForClient: ["Is the copy final?", "Which pages need animation?"],
    screeningQuestions: ["Share a Webflow site you built."],
    boostAdvice: "With a strong fit and few hires on record, a small boost could help early visibility, but it isn't necessary.",
  }),
  upwork_proposal: () => ({
    proposal: "You need a fast, clean Webflow landing page that your team can update without a developer.\n\nI've built and maintained Webflow sites with CMS collections, so your blog can be edited by anyone on your team. I'd start with layouts for your review, then build responsively and hand over a short video on editing.\n\nIs the copy final, and which sections need animation?",
    screening: [{ question: "Share a Webflow site you built.", answer: "I'll share links to the Webflow projects listed in my profile in our chat." }],
  }),
  skill_plan: () => ({
    assessment: {
      summary: "You have the product sense for this role; the gap is hands-on SQL to answer your own questions.",
      strengths: [{ strength: "Product thinking", evidence: "Your roles owned features end to end." }],
      transferable: [{ experience: "Spreadsheet analysis", howItTransfers: "Filtering and grouping translate directly to SQL." }],
      gaps: [{ skill: "SQL", importance: "must-have", currentLevel: "none shown" }],
      readiness: "developing",
      assumptions: ["The profile doesn't say how much data work you've done."],
    },
    plan: {
      phases: [
        { title: "Foundations", weeks: "1-2", goal: "Write basic queries confidently", steps: [{ id: "p1-basics", kind: "learn", title: "SELECT, WHERE, GROUP BY", detail: "Work through a free interactive SQL course's fundamentals.", hours: 6, proof: "Twenty exercises solved" }] },
        { title: "Apply it", weeks: "3-4", goal: "Answer real product questions", steps: [{ id: "p2-project", kind: "build", title: "Analyse a public dataset", detail: "Answer five product questions with SQL on a public dataset.", hours: 8, proof: "A write-up with queries and charts" }] },
      ],
      project: { title: "Product metrics teardown", brief: "Pick a public dataset and answer five product questions with SQL.", demonstrates: ["SQL", "Product thinking"] },
      leverageNow: ["Lead with your product judgement in applications"],
      caveats: ["This plan can't promise a job offer."],
    },
  }),
  opportunity_fit: () => ({ score: 74, verdict: "consider", reasons: ["Matches your Webflow experience"], gaps: ["Asks for Shopify"], concerns: ["Pay not stated"] }),
  resume_coaching: (messages) => {
    const ids = [...(messages.at(-1)?.content ?? "").matchAll(/"id": "([^"]+)"/g)].map((match) => match[1]);
    const unit = ids.find((id) => id?.startsWith("experience:")) ?? ids[0] ?? "summary";
    return {
      overall: "A solid base; the biggest gain is evidence. Most bullets describe tasks rather than results.",
      strengths: ["Clear, scannable bullets"],
      questions: [{ id: "q-results", unitId: unit, question: "What changed because of your onboarding redesign?", why: "Hiring managers look for impact.", example: "e.g. completion went from 40% to 55%" }],
      suggestions: [{ unitId: "summary", suggestion: "Lead the summary with the kind of product you build best." }],
    };
  },
  resume_part: (messages) => {
    const current = (messages.at(-1)?.content ?? "").split(/The part to rewrite \([^)]*\):\n/)[1]?.split("\n\n")[0] ?? "";
    return { text: current ? `${current.split("\n")[0]} (sharpened)` : "Rewritten." };
  },

  new_text: (messages) => {
    const current = messages[1].content.split("Its current text:\n").at(-1) ?? "";
    const lines = current.split("\n").filter(Boolean);
    return { text: lines.length > 1 ? lines.reverse().join("\n") : `In short: ${current}` };
  },
};

createServer((request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.method === "GET" && request.url === "/health") return send(200, { ok: true });
  if (request.method === "GET" && request.url === "/last") return send(200, { messages: last });
  if (request.method === "GET" && request.url === "/v1/models") {
    return send(200, { object: "list", data: [{ id: "fake-model", object: "model", created: 0, owned_by: "e2e" }] });
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") return send(404, { error: { message: "Not found" } });

  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    const body = JSON.parse(raw) as Request;
    last = body.messages;
    const name = body.response_format?.json_schema?.name;
    const answer = name && answers[name];
    if (!answer) return send(400, { error: { message: `No fake answer for "${name}".` } });
    // A moment of "thinking", so progress shows as it would.
    setTimeout(() => {
      try {
        send(200, {
          id: "fake",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "fake-model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer(body.messages)) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } catch (error) {
        send(500, { error: { message: String(error) } });
      }
    }, 300);
  });
}).listen(port, () => console.log(`Fake AI server on http://localhost:${port}`));
