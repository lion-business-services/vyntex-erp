// Public sales pages: overview, pricing, request a demo and the 7-day free trial. They render outside the workspace shell (see app/App.tsx).
import { Landing } from './landing';
import { Pricing } from './pricing';
import { RequestDemo } from './request';
import { StartTrial } from './trial';
import './marketing.css';
import './daylight.css';

/** Overview. `notFound` is set for an address that does not exist, and shows a short notice above the page. */
export function LandingPage({ notFound }: { notFound?: boolean }) { return <Landing notFound={notFound} />; }
export function PricingPage() { return <Pricing />; }
export function RequestDemoPage() { return <RequestDemo />; }
export function StartTrialPage() { return <StartTrial />; }
