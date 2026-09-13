import React, { useState, useEffect } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { LANGUAGES } from '../translations/i18n'
import { homePathFor } from '../config/navigation'
import Dropdown, { DropdownItem } from './ui/Dropdown'
import Avatar from './ui/Avatar'
import NotificationBell from './notifications/NotificationBell.jsx'
import logo from '../assets/images/logo.png'

/** One nav config, rendered at both breakpoints — the mobile menu used to
 *  silently drop the Dashboard link, stranding logged-in phone users. */
function navLinksFor(role, t) {
  /**
   * Built with homePathFor rather than the role name.
   *
   * Every other role's path happens to equal its name, so interpolating the
   * role worked by coincidence until health_worker arrived: it produced
   * /health_worker, which matches no route, so the link landed on the
   * not-found page — which renders this same navbar, so clicking Dashboard
   * from there went straight back to it and the worker was stuck in a loop.
   */
  const dashboard = { to: homePathFor(role), label: t('navbar.dashboard') }
  switch (role) {
    case 'patient':
      return [
        dashboard,
        { to: '/doctors', label: t('navbar.doctors') },
        { to: '/pharmacies', label: t('navbar.pharmacy') }
      ]
    case 'doctor':
      return [dashboard, { to: '/doctor/patients', label: t('navbar.patients') }]
    case 'pharmacy':
    case 'hospital':
    case 'health_worker':
      return [dashboard]
    default:
      return []
  }
}

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const { user, isAuthenticated, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // Close the menu on navigation, otherwise it hangs over the new page.
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Track scroll position so we can switch between transparent and solid.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleLogout = () => {
    logout()
    setMobileOpen(false)
    navigate('/')
  }

  const links = isAuthenticated ? navLinksFor(user.role, t) : []
  const current = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0]

  // Transparent only on the landing page before the user scrolls.
  const isLanding = location.pathname === '/'
  const transparent = isLanding && !scrolled && !mobileOpen

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        transparent
          ? 'bg-transparent border-b border-transparent'
          : 'bg-surface border-b border-line shadow-sm'
      }`}
    >
      <nav className="container-app flex items-center justify-between gap-4 h-16" aria-label="Main">
        <Link to="/" className="flex items-center gap-2.5 shrink-0 rounded-control" aria-label="GramSathi home">
          <img src={logo} alt="GramSathi Logo" className="w-9 h-9 object-contain rounded-lg shrink-0" />
          <span className={`font-semibold text-h3 tracking-tight transition-colors duration-300 ${transparent ? 'text-white' : 'text-ink'}`}>GramSathi</span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-1 ml-auto">
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === homePathFor(user?.role)}
              className={({ isActive }) =>
                `px-3 py-2 rounded-control text-small font-medium transition-colors ${
                  isActive
                    ? transparent ? 'text-white bg-white/20' : 'text-primary-600 bg-primary-50'
                    : transparent ? 'text-white/85 hover:text-white hover:bg-white/15' : 'text-body hover:text-ink hover:bg-surface-2'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <LanguageMenu current={current} onChange={(c) => i18n.changeLanguage(c)} t={t} transparent={transparent} />

          {isAuthenticated && <NotificationBell />}

          {!isAuthenticated ? (
            <Link
              to="/login"
              className={`btn btn-sm transition-colors duration-300 ${
                transparent
                  ? 'bg-white text-primary-700 hover:bg-primary-50 border border-white/30'
                  : 'btn-primary'
              }`}
            >
              {t('navbar.loginSignup')}
            </Link>
          ) : (
            <Dropdown
              label={t('navbar.account')}
              trigger={({ toggle, ...aria }) => (
                <button
                  type="button"
                  onClick={toggle}
                  {...aria}
                  className={`flex items-center gap-2 pl-1 pr-2 py-1 rounded-full transition-colors ${
                    transparent ? 'hover:bg-white/15' : 'hover:bg-surface-2'
                  }`}
                >
                  <Avatar name={user.name} size="sm" />
                  <span className={`text-small font-medium max-w-[10rem] truncate transition-colors duration-300 ${transparent ? 'text-white' : 'text-ink'}`}>{user.name}</span>
                  <svg className={`w-4 h-4 shrink-0 transition-colors duration-300 ${transparent ? 'text-white/70' : 'text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
            >
              {({ close }) => (
                <>
                  <div className="px-4 py-2 border-b border-line-soft mb-1">
                    <p className="text-small font-medium text-ink truncate">{user.name}</p>
                    <p className="text-caption text-muted capitalize">{t(`roles.${user.role}`, user.role)}</p>
                  </div>
                  <DropdownItem onClick={() => { close(); navigate(homePathFor(user.role)) }}>
                    {t('navbar.dashboard')}
                  </DropdownItem>
                  <DropdownItem onClick={() => { close(); navigate(`${homePathFor(user.role)}/profile`) }}>
                    {t('navbar.profile')}
                  </DropdownItem>
                  <div className="divider my-1.5" />
                  <DropdownItem onClick={() => { close(); handleLogout() }} className="text-danger-500">
                    {t('navbar.logout')}
                  </DropdownItem>
                </>
              )}
            </Dropdown>
          )}
        </div>

        {/* Mobile controls */}
        <div className="md:hidden flex items-center gap-1">
          {isAuthenticated && <NotificationBell />}
          <button
            type="button"
            className={`w-11 h-11 -mr-2 flex items-center justify-center rounded-control transition-colors ${
            transparent ? 'text-white hover:bg-white/15' : 'text-body hover:bg-surface-2'
          }`}
          onClick={() => setMobileOpen(o => !o)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          aria-label={mobileOpen ? t('navbar.closeMenu') : t('navbar.openMenu')}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path strokeLinecap="round" d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 7h16M4 12h16M4 17h16'} />
          </svg>
          </button>
        </div>
      </nav>

      {/* Mobile menu — always solid so it stays readable. */}
      {mobileOpen && (
        <div id="mobile-menu" className="md:hidden border-t border-line bg-surface animate-fade-in">
          <div className="container-app py-3 flex flex-col gap-1">
            {isAuthenticated && (
              <div className="flex items-center gap-3 px-1 py-3 mb-1 border-b border-line-soft">
                <Avatar name={user.name} size="md" />
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{user.name}</p>
                  <p className="text-caption text-muted capitalize">{t(`roles.${user.role}`, user.role)}</p>
                </div>
              </div>
            )}

            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === homePathFor(user?.role)}
                className={({ isActive }) =>
                  `px-3 py-3 rounded-control text-base font-medium min-h-touch flex items-center ${
                    isActive ? 'text-primary-600 bg-primary-50' : 'text-body hover:bg-surface-2'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}

            {isAuthenticated && (
              <NavLink
                to={`/${user.role}/profile`}
                className={({ isActive }) =>
                  `px-3 py-3 rounded-control text-base font-medium min-h-touch flex items-center ${
                    isActive ? 'text-primary-600 bg-primary-50' : 'text-body hover:bg-surface-2'
                  }`
                }
              >
                {t('navbar.profile')}
              </NavLink>
            )}

            <div className="pt-3 mt-2 border-t border-line-soft">
              <p className="text-caption font-medium text-muted mb-2 px-1">{t('navbar.language')}</p>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map(l => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => i18n.changeLanguage(l.code)}
                    aria-pressed={i18n.language === l.code}
                    className={`px-4 py-2.5 rounded-full text-small font-medium min-h-touch ${
                      i18n.language === l.code
                        ? 'bg-primary-600 text-white'
                        : 'bg-surface-2 text-body border border-line'
                    }`}
                  >
                    {l.native}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-3 mt-2 border-t border-line-soft">
              {isAuthenticated ? (
                <button type="button" onClick={handleLogout} className="btn btn-secondary btn-block">
                  {t('navbar.logout')}
                </button>
              ) : (
                <Link to="/login" className="btn btn-primary btn-block">{t('navbar.loginSignup')}</Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}


function LanguageMenu({ current, onChange, t, transparent = false }) {
  return (
    <Dropdown
      label={t('navbar.language')}
      trigger={({ toggle, ...aria }) => (
        <button
          type="button"
          onClick={toggle}
          {...aria}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-control text-small font-medium min-h-touch transition-colors ${
            transparent ? 'text-white/85 hover:text-white hover:bg-white/15' : 'text-body hover:bg-surface-2'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
          </svg>
          {current.short}
        </button>
      )}
    >
      {({ close }) => LANGUAGES.map(l => (
        <DropdownItem
          key={l.code}
          active={l.code === current.code}
          onClick={() => { onChange(l.code); close() }}
        >
          {l.native}
          {l.code !== 'en' && <span className="text-muted text-caption ml-auto">{l.label}</span>}
        </DropdownItem>
      ))}
    </Dropdown>
  )
}
