import assert from "node:assert/strict";
import test from "node:test";

import { resolveSocialUrl } from "../src/social-url.ts";

test("resolveSocialUrl expands known platform handles to canonical URLs", () => {
  assert.deepEqual(resolveSocialUrl("LinkedIn", "ada-lovelace"), {
    display: "https://www.linkedin.com/in/ada-lovelace",
    href: "https://www.linkedin.com/in/ada-lovelace",
    vcardValue: "https://www.linkedin.com/in/ada-lovelace",
  });

  assert.deepEqual(resolveSocialUrl("X (Twitter)", "@ada"), {
    display: "https://x.com/ada",
    href: "https://x.com/ada",
    vcardValue: "https://x.com/ada",
  });
});

test("resolveSocialUrl supports Bluesky handles and DIDs", () => {
  assert.deepEqual(resolveSocialUrl("Bluesky", "@alice.bsky.social"), {
    display: "https://bsky.app/profile/alice.bsky.social",
    href: "https://bsky.app/profile/alice.bsky.social",
    vcardValue: "https://bsky.app/profile/alice.bsky.social",
  });

  assert.deepEqual(resolveSocialUrl("Bluesky", "did:plc:example"), {
    display: "https://bsky.app/profile/did:plc:example",
    href: "https://bsky.app/profile/did:plc:example",
    vcardValue: "https://bsky.app/profile/did:plc:example",
  });
});

test("resolveSocialUrl maps WhatsApp phone numbers to wa.me URLs", () => {
  assert.deepEqual(resolveSocialUrl("WhatsApp", "+65 9123 4567"), {
    display: "https://wa.me/6591234567",
    href: "https://wa.me/6591234567",
    vcardValue: "https://wa.me/6591234567",
  });

  assert.deepEqual(resolveSocialUrl("WhatsApp", "(415) 555-0100"), {
    display: "https://wa.me/4155550100",
    href: "https://wa.me/4155550100",
    vcardValue: "https://wa.me/4155550100",
  });
});

test("resolveSocialUrl leaves non-phone WhatsApp values unchanged", () => {
  assert.deepEqual(resolveSocialUrl("WhatsApp", "@ada"), {
    display: "@ada",
    vcardValue: "@ada",
  });

  assert.deepEqual(resolveSocialUrl("WhatsApp", "123"), {
    display: "123",
    vcardValue: "123",
  });
});

test("resolveSocialUrl preserves explicit and bare URLs", () => {
  assert.deepEqual(resolveSocialUrl("GitHub", "https://github.com/ada"), {
    display: "https://github.com/ada",
    href: "https://github.com/ada",
    vcardValue: "https://github.com/ada",
  });

  assert.deepEqual(resolveSocialUrl("Other", "example.com/ada"), {
    display: "example.com/ada",
    href: "https://example.com/ada",
    vcardValue: "https://example.com/ada",
  });
});

test("resolveSocialUrl leaves Other non-URLs unchanged and unlinked", () => {
  assert.deepEqual(resolveSocialUrl("Other", "hello"), {
    display: "hello",
    vcardValue: "hello",
  });
});
