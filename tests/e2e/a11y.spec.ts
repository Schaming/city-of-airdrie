import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility', () => {
  test('homepage should not have any automatically detectable accessibility issues', async ({
    page,
  }) => {
    await page.goto('http://localhost:3000') // Assuming your app runs on port 3000

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('bylaws page should not have any automatically detectable accessibility issues', async ({
    page,
  }) => {
    await page.goto('http://localhost:3000/bylaws/all')

    const accessibilityScanResults = await new AxeBuilder({ page })
      // Optional: exclude specific elements if they are known false positives or 3rd party
      // .exclude('#some-element')
      .analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })
})
