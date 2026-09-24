import { Link } from "react-router-dom";

import HomeHeroPreview from "../components/HomeHeroPreview";

const HERO_FEATURES = [
  "Active recall",
  "Visual learning",
  "Immediate feedback",
  "ADHD-friendly focus",
];

const HOW_IT_WORKS = [
  {
    step: "1",
    icon: "🗺️",
    title: "Explore the domain",
    body: "Navigate visual knowledge maps and see how everything connects.",
  },
  {
    step: "2",
    icon: "🎮",
    title: "Play adaptive quizzes",
    body: "Get questions that adjust to your level and target your weak spots.",
  },
  {
    step: "3",
    icon: "📈",
    title: "Reinforce weak spots",
    body: "Focus on what you miss and watch your knowledge grow.",
  },
];

const FEATURES = [
  {
    icon: "🧭",
    title: "Knowledge Maps",
    body: "See how concepts connect instead of memorizing isolated facts.",
  },
  {
    icon: "📊",
    title: "Adaptive Quizzes",
    body: "Questions adjust to your level and target your weak spots.",
  },
  {
    icon: "🪙",
    title: "Bits & Rewards",
    body: "Earn Bits for real effort and watch your progress grow.",
  },
  {
    icon: "🎯",
    title: "Friendly Focus Design",
    body: "A calm, low-noise interface built for deep work.",
  },
];

const PASSIVE_TOOLS = [
  "Linear reading, easy to zone out",
  "Same questions for everyone",
  "Hard to see the big picture",
  "No real feedback or motivation",
  "Knowledge fades quickly",
];

const ADAPTIVE_TOOLS = [
  "Visual, interactive knowledge maps",
  "Adaptive quizzes that target your gaps",
  "See how concepts connect",
  "Immediate feedback and rewards",
  "Built for long-term retention",
];

interface Milestone {
  id: string;
  name: string;
  examCode: string;
  icon: string;
  available: boolean;
}

const MILESTONES: Milestone[] = [
  {
    id: "aws-soa-c03",
    name: "AWS Certified CloudOps Engineer – Associate",
    examCode: "SOA-C03",
    icon: "☁️",
    available: true,
  },
  {
    id: "devops",
    name: "DevOps Certification",
    examCode: "DevOps",
    icon: "⚙️",
    available: false,
  },
  {
    id: "comptia-security-plus",
    name: "CompTIA Security+",
    examCode: "SY0-701",
    icon: "🛡️",
    available: true,
  },
  {
    id: "aws-aip-c01",
    name: "AWS Certified Generative AI Developer – Professional",
    examCode: "AIP-C01",
    icon: "🤖",
    available: true,
  },
];

export default function HomePage() {
  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-copy">
          <p className="home-eyebrow">Stop rereading. Start unlocking.</p>
          <h1 id="home-hero-title" className="home-hero-title">
            Cloud certification prep that finally{" "}
            <em>keeps you engaged.</em>
          </h1>
          <p className="home-lede">
            Explore visual knowledge maps, uncover the missing pieces, and lock
            in AWS concepts with adaptive quizzes built for focus, momentum, and
            retention.
          </p>
          <div className="home-hero-actions">
            <Link className="home-btn home-btn-primary" to="/demo">
              Start Free Demo →
            </Link>
            <Link className="home-btn home-btn-ghost" to="/tracks">
              Try a Quick Quiz
            </Link>
          </div>
          <ul className="home-hero-features">
            {HERO_FEATURES.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
        <HomeHeroPreview />
      </section>

      <section className="home-section" aria-labelledby="home-how-title">
        <p className="home-eyebrow">How it works</p>
        <h2 id="home-how-title" className="home-title">
          From confusion to certification, one node at a time.
        </h2>
        <ol className="home-how">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step} className="home-how-card">
              <span className="home-how-step" aria-hidden="true">
                {item.step}
              </span>
              <div className="home-card-head">
                <span className="home-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <h3>{item.title}</h3>
              </div>
              <p>{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section" aria-labelledby="home-why-title">
        <p className="home-eyebrow">Why learners stick with it</p>
        <h2 id="home-why-title" className="home-title">
          A better way to study. A brighter way to build your future.
        </h2>
        <ul className="home-features">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="home-feature-card">
              <div className="home-card-head">
                <span className="home-icon" aria-hidden="true">
                  {feature.icon}
                </span>
                <h3>{feature.title}</h3>
              </div>
              <p>{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-section" aria-labelledby="home-compare-title">
        <p className="home-eyebrow">A clearer path for a brighter you</p>
        <h2 id="home-compare-title" className="home-title">
          Stop rereading. Start unlocking.
        </h2>
        <div className="home-compare">
          <div className="home-compare-card">
            <h3>Passive study tools</h3>
            <ul className="home-compare-list home-compare-list--passive">
              {PASSIVE_TOOLS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <span className="home-compare-vs" aria-hidden="true">
            VS
          </span>
          <div className="home-compare-card home-compare-card--adaptive">
            <h3>Adaptive Learning</h3>
            <ul className="home-compare-list home-compare-list--adaptive">
              {ADAPTIVE_TOOLS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-certs-title">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow">Certifications</p>
            <h2 id="home-certs-title" className="home-title">
              Choose your next milestone.
            </h2>
          </div>
          <Link className="home-more" to="/tracks">
            More coming soon →
          </Link>
        </div>
        <ul className="home-milestones">
          {MILESTONES.map((milestone) => (
            <li key={milestone.id}>
              {milestone.available ? (
                <Link
                  className="home-milestone home-milestone--available"
                  to={`/tracks/${milestone.id}`}
                >
                  <span className="home-card-head">
                    <span className="home-milestone-icon" aria-hidden="true">
                      {milestone.icon}
                    </span>
                    <span className="home-milestone-name">{milestone.name}</span>
                  </span>
                  <span className="badge home-milestone-badge">Available Now</span>
                  <span className="home-milestone-go" aria-hidden="true">
                    →
                  </span>
                </Link>
              ) : (
                <div className="home-milestone" aria-disabled="true">
                  <span className="home-card-head">
                    <span className="home-milestone-icon" aria-hidden="true">
                      {milestone.icon}
                    </span>
                    <span className="home-milestone-name">{milestone.name}</span>
                  </span>
                  <span className="badge wip-badge">WIP</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="home-cta" aria-labelledby="home-cta-title">
        <div className="home-cta-copy">
          <h2 id="home-cta-title">Start learning with AWS CloudOps today.</h2>
          <p>
            Get hands-on, stay motivated, and build skills that take you further.
          </p>
        </div>
        <Link className="home-btn home-btn-primary" to="/demo">
          Launch Demo →
        </Link>
      </section>
    </div>
  );
}
