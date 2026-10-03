// User-faithful interactions shared by the real-route harness and its regression tests.
// The app's radios are visually hidden <input type="radio" class="sr-only peer"> inside a <label> card (accessible markup, by design). Playwright's
// check() refuses to act on them because the label covers the input ("<label> intercepts pointer events"). A user clicks the visible card, so we click
// the <label> that contains the radio and then REQUIRE the radio to be checked. No force, no markup change.
export async function pickRadio(page, name, { timeout = 10000 } = {}) {
  const radio = (name ? page.getByRole("radio", { name }) : page.getByRole("radio")).first();
  await radio.waitFor({ state: "attached", timeout });
  const label = page.locator("label").filter({ has: radio }).first();
  if (!(await label.count())) throw new Error(`radio ${name ?? "(first)"} is not inside a <label>; cannot click its visible control`);
  await label.click({ timeout });
  if (!(await radio.isChecked())) throw new Error(`clicking the label did not select the radio ${name ?? "(first)"}`);
}

// Next.js renders <next-route-announcer> whose shadow root contains an (empty) role="alert" live region; getByRole("alert").first() can resolve to it.
// Wait for the alert that actually carries the expected text, and return that text.
export async function waitForAlertText(page, re, { timeout = 15000 } = {}) {
  const alert = page.getByRole("alert").filter({ hasText: re }).first();
  await alert.waitFor({ state: "visible", timeout });
  return (await alert.innerText()).trim();
}
