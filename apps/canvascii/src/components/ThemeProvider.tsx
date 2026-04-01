'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

type ThemeContextType = {
  theme: Theme
  mounted: boolean
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)

    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('theme') as Theme | null
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false
      const initialTheme = saved ?? (prefersDark ? 'dark' : 'light')

      setThemeState(initialTheme)
      document?.documentElement?.classList?.remove('light', 'dark')
      document?.documentElement?.classList?.add(initialTheme)
    }
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setThemeState(nextTheme)
    if (typeof window !== 'undefined') {
      localStorage?.setItem('theme', nextTheme)
      document?.documentElement?.classList?.remove('light', 'dark')
      document?.documentElement?.classList?.add(nextTheme)
    }
  }

  const setThemeDirect = (nextTheme: Theme) => {
    setThemeState(nextTheme)
    if (typeof window !== 'undefined') {
      localStorage?.setItem('theme', nextTheme)
      document?.documentElement?.classList?.remove('light', 'dark')
      document?.documentElement?.classList?.add(nextTheme)
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, mounted, toggleTheme, setTheme: setThemeDirect }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    return { theme: 'light', mounted: false, toggleTheme: () => {}, setTheme: () => {} }
  }
  return context
}
