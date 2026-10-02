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
