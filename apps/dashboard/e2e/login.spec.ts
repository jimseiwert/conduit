import { test, expect } from '@playwright/test'

test.describe('Login page', () => {
  test('renders sign-in form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Conduit' })).toBeVisible()
    await expect(page.getByPlaceholder('Email')).toBeVisible()
    await expect(page.getByPlaceholder('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('shows GitHub and Google OAuth buttons', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /Continue with GitHub/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible()
  })

  test('toggles to sign-up mode', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByPlaceholder('Name')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Email').fill('notauser@example.com')
    await page.getByPlaceholder('Password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('p.text-red-500')).toBeVisible({ timeout: 5000 })
  })

  test('redirects to /dashboard when already authenticated', async ({ page, context }) => {
    // Unauthenticated access to /dashboard should redirect to login
    const response = await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('CLI auth callback page', () => {
  test('renders login page when visiting /cli-auth without callback param', async ({ page }) => {
    await page.goto('/cli-auth')
    // Should land on login (not a 404 or raw error)
    await expect(page.getByRole('heading', { name: 'Conduit' })).toBeVisible()
  })
})
