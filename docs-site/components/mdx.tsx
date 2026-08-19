import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import { Callout } from 'fumadocs-ui/components/callout';
import { Card as FdCard, Cards } from 'fumadocs-ui/components/card';
import { Steps as FdSteps, Step as FdStep } from 'fumadocs-ui/components/steps';
import { Tabs as FdTabs, Tab as FdTab } from 'fumadocs-ui/components/tabs';
import { Accordions, Accordion as FdAccordion } from 'fumadocs-ui/components/accordion';
import { Children, isValidElement } from 'react';
import { icons } from 'lucide-react';

/*
 * The docs content is shared with the Mintlify build, so the MDX uses
 * Mintlify's component names. These wrappers map them onto Fumadocs UI.
 */

function lucide(name: string | undefined): ReactNode {
  if (!name) return undefined;
  const pascal = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  const Icon = icons[pascal as keyof typeof icons];
  return Icon ? <Icon /> : undefined;
}

type CalloutProps = { title?: ReactNode; children: ReactNode };

const Note = ({ title, children }: CalloutProps) => (
  <Callout type="info" title={title}>{children}</Callout>
);
const Info = Note;
const Tip = ({ title, children }: CalloutProps) => (
  <Callout type="idea" title={title}>{children}</Callout>
);
const Warning = ({ title, children }: CalloutProps) => (
  <Callout type="warn" title={title}>{children}</Callout>
);
const Check = ({ title, children }: CalloutProps) => (
  <Callout type="success" title={title}>{children}</Callout>
);

const Steps = ({ children }: { children: ReactNode }) => <FdSteps>{children}</FdSteps>;
const Step = ({ title, children }: { title?: ReactNode; children: ReactNode }) => (
  <FdStep>
    {title ? <h3 className="mt-0">{title}</h3> : null}
    {children}
  </FdStep>
);

type TabChild = { props: { title?: string; children?: ReactNode } };

const Tabs = ({ children }: { children: ReactNode }) => {
  const items = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => (child as unknown as TabChild).props.title ?? '');
  return <FdTabs items={items}>{children}</FdTabs>;
};
const Tab = ({ title, children }: { title?: string; children: ReactNode }) => (
  <FdTab value={title}>{children}</FdTab>
);

const CardGroup = ({ children }: { children: ReactNode; cols?: number }) => <Cards>{children}</Cards>;
const Card = ({
  title,
  icon,
  href,
  children,
}: {
  title: ReactNode;
  icon?: string;
  href?: string;
  children?: ReactNode;
}) => (
  <FdCard title={title} icon={lucide(icon)} href={href}>
    {children}
  </FdCard>
);

const AccordionGroup = ({ children }: { children: ReactNode }) => <Accordions>{children}</Accordions>;
const Accordion = ({ title, children }: { title: string; children: ReactNode }) => (
  <FdAccordion title={title}>{children}</FdAccordion>
);

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Note,
    Info,
    Tip,
    Warning,
    Check,
    Steps,
    Step,
    Tabs,
    Tab,
    Card,
    CardGroup,
    Accordion,
    AccordionGroup,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
