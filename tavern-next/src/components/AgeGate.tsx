'use client';

import Link from "next/link";
import { useEffect, useState } from "react";

const AGE_KEY = "tavern:ageConfirmed";

export const AgeGate = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const remembered = sessionStorage.getItem(AGE_KEY) === "true";
      setOpen(!remembered);
    } catch {
      setOpen(true);
    }
  }, []);

  const handleEnter = () => {
    try {
      sessionStorage.setItem(AGE_KEY, "true");
    } catch {
      // ignore storage failures
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="age-gate" role="dialog" aria-modal aria-labelledby="age-gate-title">
      <div className="age-card">
        <h2 id="age-gate-title">Welcome to the Tavern</h2>
        <p className="age-copy">
          The Dak &amp; Chog Tavern hosts on-chain wagering. You must be 19 or older to enter.
        </p>
        <div className="age-actions">
          <button onClick={handleEnter}>I&apos;m 19+ — Enter the Tavern</button>
          <Link
            href="https://www.responsiblegambling.org/"
            target="_blank"
            rel="noreferrer"
          >
            I&apos;m not 19 — Learn More
          </Link>
        </div>
        <p className="age-sub">Play responsibly. Monitor your bankroll and set personal limits.</p>
      </div>
    </div>
  );
};
