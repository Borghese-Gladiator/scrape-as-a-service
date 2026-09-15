import type { BrowserContext } from 'playwright';

export interface NodeSpec {
  text?: string;
  attrs?: Record<string, string>;
  nodes?: Record<string, NodeSpec[]>;
  onClick?: (page: FakePage, context: FakeContext) => void;
}

export interface PageSpec {
  nodes?: Record<string, NodeSpec[]>;
}

export type Route = () => PageSpec;

class FakeLocator {
  constructor(
    private readonly page: FakePage,
    private readonly resolveAll: () => NodeSpec[],
    private readonly index: number | null = null,
  ) {}

  private matches(): NodeSpec[] {
    const all = this.resolveAll();
    if (this.index === null) return all;
    const node = all[this.index];
    return node ? [node] : [];
  }

  private one(): NodeSpec | undefined {
    return this.matches()[0];
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(this.page, () =>
      this.matches().flatMap((node) => node.nodes?.[selector] ?? []),
    );
  }

  nth(index: number): FakeLocator {
    return new FakeLocator(this.page, this.resolveAll, index);
  }

  first(): FakeLocator {
    return this.nth(0);
  }

  async count(): Promise<number> {
    return this.matches().length;
  }

  async textContent(): Promise<string | null> {
    return this.one()?.text ?? null;
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.one()?.attrs?.[name] ?? null;
  }

  async click(): Promise<void> {
    const node = this.one();
    if (!node) throw new Error('click: no element matched');
    this.page.log.push('click');
    node.onClick?.(this.page, this.page.context);
  }

  async fill(value: string): Promise<void> {
    const node = this.one();
    if (!node) throw new Error('fill: no element matched');
    this.page.log.push(`fill:${value}`);
    node.text = value;
  }

  async selectOption(value: string): Promise<void> {
    if (!this.one()) throw new Error('selectOption: no element matched');
    this.page.log.push(`select:${value}`);
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    if (!this.one()) throw new Error('scrollIntoViewIfNeeded: no element matched');
    this.page.log.push('scrollIntoView');
  }

  async waitFor(options: { state?: string; timeout?: number } = {}): Promise<void> {
    if (this.matches().length === 0) {
      throw new Error(`waitFor: no element matched (state ${options.state ?? 'visible'})`);
    }
    this.page.log.push(`waitFor:${options.state ?? 'visible'}`);
  }
}

export class FakePage {
  spec: PageSpec = {};
  currentUrl = 'about:blank';
  closed = false;
  readonly log: string[] = [];
  readonly keyboard = {
    press: async (key: string): Promise<void> => {
      this.log.push(`press:${key}`);
    },
  };

  constructor(readonly context: FakeContext) {}

  url(): string {
    return this.currentUrl;
  }

  navigate(url: string): void {
    this.currentUrl = url;
    this.spec = this.context.route(url);
    this.log.push(`navigate:${url}`);
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(this, () => this.spec.nodes?.[selector] ?? []);
  }

  async goto(url: string, options: { waitUntil?: string } = {}): Promise<null> {
    this.log.push(`goto:${url}:${options.waitUntil ?? 'load'}`);
    this.navigate(url);
    return null;
  }

  async goBack(): Promise<null> {
    this.log.push('goBack');
    return null;
  }

  async waitForSelector(
    selector: string,
    options: { state?: string; timeout?: number } = {},
  ): Promise<null> {
    if ((this.spec.nodes?.[selector] ?? []).length === 0) {
      throw new Error(`waitForSelector: ${selector} not found`);
    }
    this.log.push(`waitForSelector:${selector}:${options.state ?? 'visible'}`);
    return null;
  }

  async waitForLoadState(state = 'load'): Promise<void> {
    this.log.push(`loadState:${state}`);
  }

  async screenshot(options: { fullPage?: boolean } = {}): Promise<Buffer> {
    this.log.push(`screenshot:${options.fullPage ?? true}`);
    return Buffer.from(`png:${this.currentUrl}`, 'utf8');
  }

  async pdf(): Promise<Buffer> {
    this.log.push('pdf');
    return Buffer.from(`pdf:${this.currentUrl}`, 'utf8');
  }

  async content(): Promise<string> {
    return `<html>${this.currentUrl}</html>`;
  }

  async evaluate(expression: string): Promise<null> {
    this.log.push(`evaluate:${expression}`);
    return null;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.log.push('close');
  }

  isClosed(): boolean {
    return this.closed;
  }
}

export class FakeContext {
  readonly allPages: FakePage[] = [];
  private readonly routes: Map<string, Route>;
  private readonly pageWaiters: Array<(page: FakePage) => void> = [];
  private readonly queuedPages: FakePage[] = [];

  constructor(routes: Record<string, Route> = {}) {
    this.routes = new Map(Object.entries(routes));
  }

  route(url: string): PageSpec {
    const make = this.routes.get(url);
    return make ? make() : {};
  }

  async newPage(): Promise<FakePage> {
    const page = new FakePage(this);
    this.allPages.push(page);
    return page;
  }

  pages(): FakePage[] {
    return this.allPages.filter((page) => !page.closed);
  }

  /** Mimic a control that opens a tab: create the page and fire the `page` event. */
  openPage(url: string): FakePage {
    const page = new FakePage(this);
    this.allPages.push(page);
    page.navigate(url);
    const waiter = this.pageWaiters.shift();
    if (waiter) waiter(page);
    else this.queuedPages.push(page);
    return page;
  }

  async waitForEvent(event: string): Promise<FakePage> {
    if (event !== 'page') throw new Error(`unsupported event: ${event}`);
    const queued = this.queuedPages.shift();
    if (queued) return queued;
    return new Promise<FakePage>((resolve) => {
      this.pageWaiters.push(resolve);
    });
  }

  async close(): Promise<void> {
    for (const page of this.allPages) page.closed = true;
  }

  asBrowserContext(): BrowserContext {
    return this as unknown as BrowserContext;
  }
}

export function textNode(text: string, attrs: Record<string, string> = {}): NodeSpec {
  return { text, attrs };
}
