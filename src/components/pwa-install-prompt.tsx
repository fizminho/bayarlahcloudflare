'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const subscribeToInstallState = (callback: () => void) => {
  const media = window.matchMedia('(display-mode: standalone)')
  media.addEventListener('change', callback)
  window.addEventListener('appinstalled', callback)
  return () => {
    media.removeEventListener('change', callback)
    window.removeEventListener('appinstalled', callback)
  }
}

const getIosInstallState = () => {
  const ua = window.navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  return ios && !standalone
}

export default function PwaInstallPrompt() {
  const isIos = useSyncExternalStore(subscribeToInstallState, getIosInstallState, () => false)
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setPromptEvent(null)
      setShowIosHelp(false)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (isIos) {
      setShowIosHelp(value => !value)
      return
    }
    if (!promptEvent) return
    await promptEvent.prompt()
    await promptEvent.userChoice
    setPromptEvent(null)
  }

  if (!isIos && !promptEvent) return null

  return (
    <div className="mb-2 text-center">
      <button onClick={install} className="text-[11px] font-semibold tracking-widest text-gray-500 underline underline-offset-4">
        INSTALL BAYARLAH
      </button>
      {showIosHelp && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          Tap the Share button in Safari, then choose “Add to Home Screen”.
        </p>
      )}
    </div>
  )
}
