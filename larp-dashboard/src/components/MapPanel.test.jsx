import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handlers: {}, maps: [], markers: [] }))

vi.mock('maplibre-gl', () => {
  class Map {
    constructor() {
      this.handlers = {}
      this.sources = {}
      this.canvas = { style: {} }
      this.doubleClickZoom = { disable: vi.fn(), enable: vi.fn() }
      this.resize = vi.fn()
      this.remove = vi.fn()
      this.fitBounds = vi.fn()
      this.flyTo = vi.fn()
      this.getZoom = () => 12
      mocks.maps.push(this)
      mocks.handlers = this.handlers
    }
    on(event, layerOrHandler, maybeHandler) {
      const handler = maybeHandler ?? layerOrHandler
      const key = maybeHandler ? `${event}:${layerOrHandler}` : event
      this.handlers[key] = handler
      return this
    }
    addControl() { return this }
    addSource(id) { this.sources[id] = { setData: vi.fn() } }
    addLayer() {}
    getSource(id) { return this.sources[id] }
    getCanvas() { return this.canvas }
  }
  class Marker {
    constructor() { mocks.markers.push(this) }
    setLngLat() { return this }
    addTo() { return this }
    remove() {}
    getElement() { return document.createElement('div') }
  }
  class NavigationControl {}
  class LngLatBounds { extend() { return this } }
  return { default: { Map, Marker, NavigationControl, LngLatBounds } }
})

import MapPanel from './MapPanel'

function props(overrides = {}) {
  return {
    active: true,
    zones: [],
    positions: {},
    members: [],
    characters: [],
    factions: [],
    pendingEvents: [],
    usernameOf: () => 'someone',
    zoneNameOf: () => 'a zone',
    saveZone: vi.fn().mockResolvedValue(null),
    deleteZone: vi.fn().mockResolvedValue(null),
    confirmEvent: vi.fn(),
    dismissEvent: vi.fn(),
    ...overrides,
  }
}

const tap = (lng, lat) => act(() => { mocks.handlers.click({ lngLat: { lng, lat } }) })

beforeEach(() => {
  mocks.maps.length = 0
  mocks.markers.length = 0
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MapPanel touch polygon drawing', () => {
  it('draws with taps, undoes committed points, finishes into the editor and saves a ring closed once', async () => {
    const panelProps = props()
    render(<MapPanel {...panelProps} />)
    act(() => { mocks.handlers.load() })

    fireEvent.click(screen.getByRole('button', { name: '+ Polygon' }))
    const finish = screen.getByRole('button', { name: 'Finish polygon' })
    const undo = screen.getByRole('button', { name: 'Undo last point' })
    expect(finish.disabled).toBe(true)
    expect(undo.disabled).toBe(true)

    tap(24.70, 42.10)
    tap(24.71, 42.10)
    tap(24.71, 42.10) // a repeated tap on the same spot is not a distinct vertex
    expect(screen.getByRole('status').textContent).toContain('3 points')
    expect(finish.disabled).toBe(true)

    tap(24.71, 42.11)
    expect(finish.disabled).toBe(false)

    fireEvent.click(undo)
    expect(screen.getByRole('status').textContent).toContain('3 points')
    expect(finish.disabled).toBe(true)

    tap(24.71, 42.11)
    tap(24.70, 42.11)
    fireEvent.click(finish)

    expect(await screen.findByText('New zone')).toBeTruthy()
    expect(panelProps.saveZone).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Finish polygon' })).toBeNull()
    expect(mocks.maps[0].doubleClickZoom.enable).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Create zone' }))
    await waitFor(() => expect(panelProps.saveZone).toHaveBeenCalledOnce())
    const saved = panelProps.saveZone.mock.calls[0][0]
    expect(saved.shape).toBe('polygon')
    expect(saved.geog).toBe('SRID=4326;POLYGON((24.7 42.1, 24.71 42.1, 24.71 42.11, 24.7 42.11, 24.7 42.1))')
    expect(await screen.findByText('Zone "New polygon zone" created.')).toBeTruthy()
  })

  it('cancel saves nothing and clears the draft', () => {
    const panelProps = props()
    render(<MapPanel {...panelProps} />)
    act(() => { mocks.handlers.load() })
    fireEvent.click(screen.getByRole('button', { name: '+ Polygon' }))
    tap(24.70, 42.10)
    tap(24.71, 42.10)
    tap(24.71, 42.11)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Finish polygon' })).toBeNull()
    expect(screen.queryByText('New zone')).toBeNull()
    expect(panelProps.saveZone).not.toHaveBeenCalled()
    expect(mocks.maps[0].sources.draw.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] })
  })

  it('keeps desktop double-click finishing and Escape cancelling', async () => {
    render(<MapPanel {...props()} />)
    act(() => { mocks.handlers.load() })
    fireEvent.click(screen.getByRole('button', { name: '+ Polygon' }))
    tap(24.70, 42.10)
    tap(24.71, 42.10)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(screen.queryByRole('button', { name: 'Finish polygon' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Polygon' }))
    tap(24.70, 42.10)
    tap(24.71, 42.10)
    tap(24.71, 42.11)
    tap(24.71, 42.11) // second click of the double-click lands on the same spot
    const preventDefault = vi.fn()
    act(() => { mocks.handlers.dblclick({ preventDefault }) })
    expect(preventDefault).toHaveBeenCalled()
    expect(await screen.findByText('New zone')).toBeTruthy()
  })

  it('sets a circle radius from the second tap when no hover events exist', async () => {
    const panelProps = props()
    render(<MapPanel {...panelProps} />)
    act(() => { mocks.handlers.load() })
    fireEvent.click(screen.getByRole('button', { name: '+ Circle' }))
    tap(24.70, 42.10)
    tap(24.70, 42.101) // ~111 m north
    expect(await screen.findByText('New zone')).toBeTruthy()
    const radius = Number(screen.getByLabelText('Radius (m)').value)
    expect(radius).toBeGreaterThan(100)
    expect(radius).toBeLessThan(125)
  })

  it('keeps one map instance and resizes it when the tab becomes visible again', () => {
    const { rerender } = render(<MapPanel {...props({ active: true })} />)
    act(() => { mocks.handlers.load() })
    rerender(<MapPanel {...props({ active: false })} />)
    rerender(<MapPanel {...props({ active: true })} />)
    expect(mocks.maps).toHaveLength(1)
    expect(mocks.maps[0].resize).toHaveBeenCalled()
  })
})
