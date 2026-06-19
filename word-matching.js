const didYouMean = require('didyoumean');
const readline = require('readline');

// Always return the closest match regardless of similarity score.
didYouMean.threshold = null;

// Normalize user input and keywords into a consistent searchable form.
function normalizeForMatching(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/\basp\s*\.?\s*net\b/g, 'asp.net')
        .replace(/\b(dot\s*net|dotnet|\.net)\b/g, '.net')
        .replace(/\bc\s*sharp\b/g, 'c#')
        .replace(/\bc\s*plus\s*plus\b/g, 'c++')
        .replace(/\bnode\s*js\b/g, 'node.js')
        .replace(/[^a-z0-9\s\-+.#]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// ─── Phase 1: Role Clusters ───────────────────────────────────────────────────
// Key   = canonical role name (the specific role with its own set of expectations).
// Value = every synonym / variant a user might type that means exactly this role.
//
// DESIGN RULE: if two titles have different day-to-day responsibilities or
// required skills, they live in SEPARATE clusters even if they sound similar.
// e.g. "Backend Developer" and "Frontend Developer" are different clusters.
const roleClusters = {

    // ── Engineering ──────────────────────────────────────────────────────────
    // Expectation: server-side logic, APIs, databases, business logic, scalability.
    'Backend Developer': [
        'Backend Developer', 'Backend Engineer', 'Server Side Developer',
        'Server Developer', 'API Developer', 'REST Developer',
        'Backend Programmer', 'Server Side Engineer', 'Application Backend Developer',
    ],

    // Expectation: .NET ecosystem, C#, ASP.NET, enterprise APIs, Microsoft stack.
    '.NET Developer': [
        '.NET Developer', 'Dotnet Developer', 'Dot Net Developer',
        'ASP.NET Developer', 'ASP.NET Core Developer', 'C# Developer',
        'C Sharp Developer', '.NET Engineer', 'Dotnet Engineer',
    ],

    // Expectation: Python backend services, APIs, frameworks, scripting-heavy backend work.
    'Python Developer': [
        'Python Developer', 'Python Engineer', 'Django Developer',
        'Flask Developer', 'FastAPI Developer',
    ],

    // Expectation: Java/JVM backend development, Spring ecosystem, enterprise services.
    'Java Developer': [
        'Java Developer', 'Java Engineer', 'Spring Developer',
        'Spring Boot Developer', 'JVM Developer',
    ],

    // Expectation: Node.js backend, event-driven services, JavaScript/TypeScript APIs.
    'Node.js Developer': [
        'Node Developer', 'Node.js Developer', 'Node JS Developer',
        'Node Engineer', 'Express Developer',
    ],

    // Expectation: high-performance backend services and systems in Go.
    'Go Developer': [
        'Go Developer', 'Golang Developer', 'Go Engineer',
    ],

    // Expectation: Ruby backend web applications, Rails ecosystem.
    'Ruby Developer': [
        'Ruby Developer', 'Ruby on Rails Developer', 'Rails Developer',
    ],

    // Expectation: PHP server-side apps and frameworks.
    'PHP Developer': [
        'PHP Developer', 'Laravel Developer', 'Symfony Developer',
    ],

    // Expectation: systems/backend development with Rust.
    'Rust Developer': [
        'Rust Developer', 'Rust Engineer',
    ],

    // Expectation: performance-critical application and systems development in C++.
    'C++ Developer': [
        'C++ Developer', 'CPP Developer', 'C Plus Plus Developer',
    ],

    // Expectation: browser-side UI, HTML/CSS/JS, frameworks, accessibility, UX implementation.
    'Frontend Developer': [
        'Frontend Developer', 'Frontend Engineer', 'UI Developer',
        'Client Side Developer', 'Client Side Engineer', 'Web UI Developer',
        'Frontend Programmer', 'React Developer', 'Angular Developer',
        'Vue Developer', 'Web Developer', 'Web Engineer', 'UI Engineer',
    ],

    // Expectation: both frontend and backend; owns full feature delivery end-to-end.
    'Full Stack Developer': [
        'Full Stack Developer', 'Full Stack Engineer', 'Full Stack Programmer',
        'End to End Developer', 'Full Stack Web Developer', 'Full Stack Software Engineer',
    ],

    // Expectation: general software design, architecture, OOP, algorithms, cross-cutting concerns.
    'Software Engineer': [
        'Software Engineer', 'Software Developer', 'Application Developer',
        'Application Programmer', 'Software Programmer', 'Programmer',
        'Coder', 'Integration Developer', 'Staff Engineer', 'Principal Engineer',
        'Senior Developer', 'Junior Developer', 'Lead Developer',
    ],

    // Expectation: iOS/Android apps, mobile UX, device APIs, app store deployment.
    'Mobile Developer': [
        'Mobile Developer', 'Mobile App Developer', 'Mobile Engineer',
        'iOS Developer', 'iOS Engineer', 'Android Developer', 'Android Engineer',
        'React Native Developer', 'Flutter Developer', 'Cross Platform Developer',
        'Swift Developer', 'Kotlin Developer',
    ],

    // Expectation: firmware, microcontrollers, RTOS, hardware-level programming, IoT.
    'Embedded Engineer': [
        'Embedded Engineer', 'Embedded Developer', 'Embedded Systems Engineer',
        'Firmware Engineer', 'Firmware Developer', 'Hardware Engineer',
        'FPGA Engineer', 'IoT Engineer', 'Systems Programmer',
        'Microcontroller Developer', 'RTOS Developer',
    ],

    // Expectation: game engines, graphics, gameplay systems, physics, performance.
    'Game Developer': [
        'Game Developer', 'Game Engineer', 'Gameplay Engineer',
        'Unity Developer', 'Unreal Engine Developer', 'Graphics Engineer',
        'Game Programmer', 'Game Designer', '3D Developer',
    ],

    // Expectation: smart contracts, decentralized apps, blockchain protocols, cryptography.
    'Blockchain Developer': [
        'Blockchain Developer', 'Blockchain Engineer', 'Smart Contract Developer',
        'Web3 Developer', 'Solidity Developer', 'DApp Developer',
        'Crypto Developer', 'Decentralized App Developer', 'Web3 Engineer',
    ],

    // ── Data ─────────────────────────────────────────────────────────────────
    // Expectation: ML models, statistics, experiments, hypothesis testing, research.
    'Data Scientist': [
        'Data Scientist', 'Applied Data Scientist', 'ML Scientist',
        'Statistical Modeler', 'Research Data Scientist', 'Quantitative Analyst',
        'Statistical Analyst', 'Computational Scientist',
    ],

    // Expectation: SQL, dashboards, business insights, KPIs, reporting — no model building.
    'Data Analyst': [
        'Data Analyst', 'Business Intelligence Analyst', 'BI Analyst',
        'Analytics Analyst', 'Reporting Analyst', 'Insights Analyst',
        'Business Analyst', 'BI Developer', 'Database Analyst',
        'Research Analyst',
    ],

    // Expectation: data pipelines, ETL, data warehouse, streaming, infrastructure for data.
    'Data Engineer': [
        'Data Engineer', 'Big Data Engineer', 'ETL Developer',
        'Data Pipeline Engineer', 'Data Infrastructure Engineer',
        'Analytics Engineer', 'Data Architect', 'Data Platform Engineer',
        'Hadoop Engineer', 'Spark Engineer',
    ],

    // ── AI / ML ───────────────────────────────────────────────────────────────
    // Expectation: building and shipping production ML systems, feature engineering, model training.
    'Machine Learning Engineer': [
        'Machine Learning Engineer', 'ML Engineer', 'AI Engineer',
        'Artificial Intelligence Engineer', 'Deep Learning Engineer',
        'NLP Engineer', 'Computer Vision Engineer', 'Applied ML Engineer',
        'Generative AI Engineer', 'LLM Engineer',
    ],

    // Expectation: novel research, papers, algorithm design, academic/R&D focus.
    'AI Researcher': [
        'AI Researcher', 'ML Researcher', 'Research Scientist',
        'Applied Scientist', 'AI Scientist', 'Deep Learning Researcher',
        'NLP Researcher', 'Computer Vision Researcher',
    ],

    // Expectation: model serving, monitoring, CI/CD for ML, infra for ML pipelines — not model building.
    'MLOps Engineer': [
        'MLOps Engineer', 'ML Ops Engineer', 'ML Platform Engineer',
        'AI Infrastructure Engineer', 'Model Deployment Engineer',
        'Prompt Engineer',
    ],

    // ── DevOps / Cloud ────────────────────────────────────────────────────────
    // Expectation: CI/CD pipelines, automation, deployment, dev-prod bridge.
    'DevOps Engineer': [
        'DevOps Engineer', 'DevOps Specialist', 'Deployment Engineer',
        'Release Engineer', 'Build Engineer', 'CI CD Engineer',
        'Platform Engineer', 'Infrastructure Automation Engineer',
    ],

    // Expectation: cloud resource provisioning, IaC, cost optimisation, cloud-native services.
    'Cloud Engineer': [
        'Cloud Engineer', 'Cloud Developer', 'Cloud Infrastructure Engineer',
        'AWS Engineer', 'Azure Engineer', 'GCP Engineer',
        'Cloud Solutions Engineer', 'Infrastructure Engineer',
    ],

    // Expectation: reliability, SLOs, incident management, on-call, capacity planning.
    'Site Reliability Engineer': [
        'Site Reliability Engineer', 'SRE', 'Reliability Engineer',
        'Production Engineer', 'Operations Engineer',
    ],

    // Expectation: end-to-end technical architecture, vendor selection, system design across teams.
    'Solutions Architect': [
        'Solutions Architect', 'Cloud Architect', 'Technical Architect',
        'Enterprise Architect', 'Systems Architect', 'IT Architect',
    ],

    // ── Security ──────────────────────────────────────────────────────────────
    // Expectation: offensive security, exploiting vulnerabilities, penetration tests, bug bounty.
    'Penetration Tester': [
        'Penetration Tester', 'Ethical Hacker', 'Red Team Engineer',
        'Offensive Security Engineer', 'Security Researcher',
        'Bug Bounty Hunter', 'Vulnerability Researcher',
    ],

    // Expectation: building secure systems, AppSec, code reviews, security tooling.
    'Security Engineer': [
        'Security Engineer', 'Cybersecurity Engineer', 'Application Security Engineer',
        'Information Security Engineer', 'Security Software Engineer',
        'Security Architect', 'Cryptographer',
    ],

    // Expectation: monitoring dashboards, alert triage, incident response, threat detection — reactive.
    'SOC Analyst': [
        'SOC Analyst', 'Security Operations Analyst', 'Cybersecurity Analyst',
        'Information Security Analyst', 'Threat Intelligence Analyst',
        'Incident Response Analyst', 'Blue Team Engineer',
        'Security Operations Center Analyst', 'Vulnerability Analyst',
    ],

    // ── QA / Testing ─────────────────────────────────────────────────────────
    // Expectation: test planning, manual testing, quality processes, defect tracking.
    'QA Engineer': [
        'QA Engineer', 'Quality Assurance Engineer', 'Quality Analyst',
        'QA Lead', 'Software Tester', 'Manual Tester', 'Test Engineer',
        'QA Analyst',
    ],

    // Expectation: writing automated test frameworks, CI integration, SDET work — coding focused.
    'Test Automation Engineer': [
        'Test Automation Engineer', 'Automation Tester', 'SDET',
        'Software Development Engineer in Test', 'Automation QA Engineer',
        'QA Automation Engineer', 'Test Developer',
    ],

    // Expectation: load testing, benchmarking, identifying bottlenecks, scalability validation.
    'Performance Tester': [
        'Performance Tester', 'Load Tester', 'Performance Engineer',
        'Stress Tester', 'Scalability Tester',
    ],

    // ── Design ────────────────────────────────────────────────────────────────
    // Expectation: user research, wireframes, prototypes, usability — outcome focused.
    'UX Designer': [
        'UX Designer', 'User Experience Designer', 'Product Designer',
        'Interaction Designer', 'Experience Designer', 'User Researcher',
        'UX Researcher', 'UI UX Designer',
    ],

    // Expectation: visual design, style guides, pixel-perfect screens, design systems — output focused.
    'UI Designer': [
        'UI Designer', 'User Interface Designer', 'Visual Designer',
        'Graphic Designer', 'Web Designer', 'Interface Designer',
    ],

    // ── Management ────────────────────────────────────────────────────────────
    // Expectation: product roadmap, prioritisation, stakeholder management, discovery.
    'Product Manager': [
        'Product Manager', 'Senior Product Manager', 'Associate Product Manager',
        'Technical Product Manager', 'APM', 'PM',
    ],

    // Expectation: managing engineers, hiring, performance reviews, team health — people leadership.
    'Engineering Manager': [
        'Engineering Manager', 'Software Engineering Manager', 'Tech Lead Manager',
        'Director of Engineering', 'VP of Engineering', 'CTO',
        'Head of Engineering',
    ],

    // Expectation: agile facilitation, sprint ceremonies, impediment removal — process focused.
    'Scrum Master': [
        'Scrum Master', 'Agile Coach', 'Agile Scrum Master',
        'Agile Delivery Manager', 'Sprint Master',
    ],

    // Expectation: owning delivery of a project end-to-end, timeline, risk, budget.
    'Project Manager': [
        'Project Manager', 'Technical Project Manager', 'Program Manager',
        'IT Project Manager', 'Delivery Manager', 'Project Lead',
    ],

    // Expectation: bridging business and tech, requirements gathering, process modelling — no coding.
    'Business Analyst': [
        'Business Analyst', 'Technical Business Analyst', 'Systems Analyst',
        'IT Business Analyst', 'Requirements Analyst', 'Process Analyst',
    ],

    // Expectation: technical ownership of a team feature area, coding + design + mentoring.
    'Tech Lead': [
        'Tech Lead', 'Technical Lead', 'Team Lead', 'Lead Engineer',
        'Lead Developer', 'Staff Engineer', 'Principal Engineer',
    ],

    // ── Infrastructure ────────────────────────────────────────────────────────
    // Expectation: routers, switches, VLANs, firewalls, protocols — physical/virtual networking.
    'Network Engineer': [
        'Network Engineer', 'Network Administrator', 'Network Architect',
        'Network Specialist', 'Network Technician', 'Cisco Engineer',
    ],

    // Expectation: OS administration, patching, user accounts, server uptime.
    'System Administrator': [
        'System Administrator', 'Sysadmin', 'Systems Engineer',
        'Linux Administrator', 'Windows Administrator', 'IT Administrator',
        'IT Infrastructure Engineer', 'Server Administrator',
    ],

    // Expectation: schema design, query tuning, backups, replication, DB health.
    'Database Administrator': [
        'Database Administrator', 'DBA', 'Database Engineer',
        'SQL DBA', 'Oracle DBA', 'MySQL DBA', 'PostgreSQL DBA',
        'Database Manager', 'Storage Engineer',
    ],

    // ── Support ───────────────────────────────────────────────────────────────
    // Expectation: troubleshooting end-user/customer issues, ticketing, escalation.
    'Technical Support Engineer': [
        'Technical Support Engineer', 'IT Support Specialist', 'IT Technician',
        'Help Desk Technician', 'IT Helpdesk', 'Desktop Support Engineer',
        'Customer Support Engineer', 'Service Desk Analyst',
        'Technical Support Specialist', 'IT Support Analyst',
    ],
};

// Role metadata used to return meaningful domains and interview/study topics.
const roleProfiles = {
    'Backend Developer': {
        domain: 'Backend Engineering (General)',
        topics: ['APIs', 'Databases', 'Authentication', 'Scalability', 'Caching'],
    },
    '.NET Developer': {
        domain: 'Backend Engineering (.NET)',
        topics: ['C#', '.NET / ASP.NET Core', 'Entity Framework', 'REST APIs', 'Azure Basics'],
    },
    'Python Developer': {
        domain: 'Backend Engineering (Python)',
        topics: ['Python', 'Django/Flask/FastAPI', 'ORMs', 'API Design', 'Async Programming'],
    },
    'Java Developer': {
        domain: 'Backend Engineering (Java)',
        topics: ['Java', 'Spring Boot', 'JPA/Hibernate', 'Microservices', 'JVM Performance'],
    },
    'Node.js Developer': {
        domain: 'Backend Engineering (Node.js)',
        topics: ['Node.js', 'Express/Nest', 'Async Patterns', 'API Security', 'TypeScript'],
    },
    'Go Developer': {
        domain: 'Backend Engineering (Go)',
        topics: ['Go', 'Concurrency', 'gRPC/REST', 'Profiling', 'Cloud-native Services'],
    },
    'Ruby Developer': {
        domain: 'Backend Engineering (Ruby)',
        topics: ['Ruby', 'Rails', 'ActiveRecord', 'MVC Design', 'Testing'],
    },
    'PHP Developer': {
        domain: 'Backend Engineering (PHP)',
        topics: ['PHP', 'Laravel/Symfony', 'MVC', 'MySQL', 'API Development'],
    },
    'Rust Developer': {
        domain: 'Backend/Systems Engineering (Rust)',
        topics: ['Rust Ownership', 'Concurrency Safety', 'Performance', 'Systems APIs', 'Web Backends'],
    },
    'C++ Developer': {
        domain: 'Systems/Performance Engineering (C++)',
        topics: ['Modern C++', 'Memory Management', 'STL', 'Multithreading', 'Optimization'],
    },
};

// ─── Phase 2: Flat keyword list + reverse-lookup map ──────────────────────────
// allKeywords  → fed directly to didYouMean for fuzzy matching.
// keywordToRole → maps any matched keyword back to its canonical role name.
const keywordToRole = {};               // reverse lookup dictionary
const keywordToLabel = {};              // normalized keyword -> original label
const keywordSet = new Set();

for (const [canonicalRole, keywords] of Object.entries(roleClusters)) {
    for (const keyword of keywords) {
        const normalizedKeyword = normalizeForMatching(keyword);
        keywordSet.add(normalizedKeyword);

        if (!keywordToLabel[normalizedKeyword]) {
            keywordToLabel[normalizedKeyword] = keyword;
        }

        // Keep first mapping when different synonyms normalize to same token.
        if (!keywordToRole[normalizedKeyword]) {
            keywordToRole[normalizedKeyword] = canonicalRole;
        }
    }
}

const allKeywords = [...keywordSet];

function levenshteinDistance(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = 0; i < rows; i += 1) dp[i][0] = i;
    for (let j = 0; j < cols; j += 1) dp[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }

    return dp[a.length][b.length];
}

function similarityScore(a, b) {
    const longest = Math.max(a.length, b.length);
    if (longest === 0) return 1;
    return 1 - (levenshteinDistance(a, b) / longest);
}

function tokenOverlapScore(a, b) {
    const aTokens = new Set(a.split(/\s+/).filter(Boolean));
    const bTokens = new Set(b.split(/\s+/).filter(Boolean));
    if (!aTokens.size || !bTokens.size) return 0;

    let overlap = 0;
    for (const token of aTokens) {
        if (bTokens.has(token)) overlap += 1;
    }

    return overlap / Math.max(aTokens.size, bTokens.size);
}

function buildResult(input, sanitized, canonicalRole, matchedKeyword) {
    const profile = roleProfiles[canonicalRole];
    return {
        input,
        sanitized,
        matchedKeyword,
        canonicalRole,
        domain: profile?.domain ?? canonicalRole ?? 'Unknown',
        topics: profile?.topics ?? [],
    };
}

function getSuggestions(normalizedInput, limit = 4, minScore = 0.45) {
    const ranked = allKeywords
        .map((keyword) => {
            const editScore = similarityScore(normalizedInput, keyword);
            const overlapScore = tokenOverlapScore(normalizedInput, keyword);
            const score = (editScore * 0.65) + (overlapScore * 0.35);
            return { keyword, score };
        })
        .filter((candidate) => candidate.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

    const byRole = new Map();
    for (const candidate of ranked) {
        const canonicalRole = keywordToRole[candidate.keyword];
        if (!canonicalRole || byRole.has(canonicalRole)) continue;

        const profile = roleProfiles[canonicalRole];
        byRole.set(canonicalRole, {
            canonicalRole,
            keyword: keywordToLabel[candidate.keyword] ?? candidate.keyword,
            domain: profile?.domain ?? canonicalRole,
            topics: profile?.topics ?? [],
        });

        if (byRole.size >= limit) break;
    }

    return [...byRole.values()];
}

// ─── Phase 3: Input Sanitiser ─────────────────────────────────────────────────
function sanitizeInput(raw) {
    return raw
        .trim()                           // remove leading/trailing whitespace
        .replace(/[^a-zA-Z0-9\s\-+.#]/g, '') // keep tech symbols like ., #, +
        .replace(/\s{2,}/g, ' ');          // collapse multiple spaces into one
}

// ─── Phase 4: Classifier ──────────────────────────────────────────────────────
// Pipeline: raw input → sanitize → fuzzy-match keyword → canonical role → domain
function classifyRole(userInput) {
    const sanitized = sanitizeInput(userInput);
    const normalizedInput = normalizeForMatching(userInput);

    if (!normalizedInput) {
        return { status: 'empty', input: userInput, sanitized: '', canonicalRole: null, domain: null, topics: [] };
    }

    const exactCanonicalRole = keywordToRole[normalizedInput];
    if (exactCanonicalRole) {
        return { status: 'exact', ...buildResult(userInput, sanitized, exactCanonicalRole, normalizedInput) };
    }

    const suggestions = getSuggestions(normalizedInput);
    if (suggestions.length) {
        return { status: 'suggestions', input: userInput, sanitized, suggestions };
    }

    return { status: 'none', input: userInput, sanitized, canonicalRole: null, domain: 'Unknown', topics: [] };
}

function printClassificationResult({ sanitized, canonicalRole, domain, topics }) {
    console.log(`  Sanitized      : ${sanitized}`);
    console.log(`  Canonical Role : ${canonicalRole ?? 'No match found'}`);
    console.log(`  Domain         : ${domain}\n`);
    if (topics.length) {
        console.log(`  Topics         : ${topics.join(', ')}\n`);
    }
}

// ─── Interactive CLI ──────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n==========================================');
console.log('   IT Job Role Classifier');
console.log('   Sanitize -> Spell-correct -> Domain');
console.log('==========================================');
console.log('Type a job role and press Enter.');
console.log('Type "exit" to quit.\n');

function prompt() {
    rl.question('Job role: ', (input) => {
        const role = input.trim();

        if (role.toLowerCase() === 'exit') {
            console.log('Goodbye!');
            rl.close();
            return;
        }

        const result = classifyRole(role);
        const { sanitized } = result;

        if (!sanitized) {
            console.log('  ⚠  Please enter a valid job role.\n');
            prompt();
            return;
        }

        if (result.status === 'suggestions') {
            console.log(`  Sanitized      : ${sanitized}`);
            console.log('  No exact match found. Did you mean:');
            result.suggestions.forEach((option, index) => {
                console.log(`  ${index + 1}. ${option.canonicalRole} (${option.keyword})`);
            });
            console.log('');

            rl.question('Select option number (or press Enter to skip): ', (selection) => {
                const selectedIndex = Number.parseInt(selection, 10) - 1;
                if (Number.isNaN(selectedIndex) || !result.suggestions[selectedIndex]) {
                    console.log('  No selection made.\n');
                    prompt();
                    return;
                }

                const selected = result.suggestions[selectedIndex];
                printClassificationResult({
                    sanitized,
                    canonicalRole: selected.canonicalRole,
                    domain: selected.domain,
                    topics: selected.topics,
                });
                prompt();
            });
            return;
        }

        printClassificationResult(result);
        prompt();
    });
}

prompt();

// node .\word-matching.js