import type { PinnedSubject } from "@ffp/shared-types";
import { appOrigin, createSeedClient } from "../../../e2e-stack/src/index.ts";

const pricingValues = [
  { value: { tier: "free" }, name: "Free" },
  { value: { tier: "pro" }, name: "Pro" },
];

export { appOrigin, createSeedClient };

export async function ensureHarnessFlags() {
  const { seed } = await createSeedClient();
  await seed.ensureBooleanFlag("new-checkout");
  await seed.ensureJsonFlag("pricing", pricingValues);
  return seed;
}

export async function configureCheckout(
  seed: Awaited<ReturnType<typeof ensureHarnessFlags>>,
  options: {
    enabled: boolean;
    defaultValueIndex: number;
    disabledValueIndex?: number;
    pinned?: PinnedSubject[];
  },
): Promise<void> {
  await seed.setFlagConfig("new-checkout", {
    enabled: options.enabled,
    disabledValueIndex: options.disabledValueIndex ?? 0,
    defaultServe: { kind: "value", valueIndex: options.defaultValueIndex },
    pinned: options.pinned ?? [],
    rules: [],
  });
}

export async function configurePricing(
  seed: Awaited<ReturnType<typeof ensureHarnessFlags>>,
  valueIndex: number,
): Promise<void> {
  await seed.setFlagConfig("pricing", {
    enabled: true,
    disabledValueIndex: 0,
    defaultServe: { kind: "value", valueIndex },
    pinned: [],
    rules: [],
  });
}
