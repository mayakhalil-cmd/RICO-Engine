import { createContext, useContext } from 'react'

// True inside a docked panel. Panels then drop their own frame and title,
// because the dock tab already shows them.
export const InDock = createContext(false)
export const useInDock = () => useContext(InDock)
