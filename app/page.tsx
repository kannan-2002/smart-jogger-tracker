"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Play, Pause, Square, MapPin, Wifi, WifiOff, Clock, Route, Zap } from "lucide-react"

interface Position {
  lat: number
  lng: number
  timestamp: number
}

interface JoggingStats {
  distance: number
  duration: number
  averageSpeed: number
  maxSpeed: number
  calories: number
}

type JoggingState = "idle" | "running" | "paused" | "stopped"

export default function JoggingAssistant() {
  const [state, setState] = useState<JoggingState>("idle")
  const [positions, setPositions] = useState<Position[]>([])
  const [currentPosition, setCurrentPosition] = useState<Position | null>(null)
  const [stats, setStats] = useState<JoggingStats>({
    distance: 0,
    duration: 0,
    averageSpeed: 0,
    maxSpeed: 0,
    calories: 0,
  })
  const [networkStatus, setNetworkStatus] = useState<{
    online: boolean
    effectiveType?: string
    downlink?: number
  }>({ online: navigator.onLine })
  const [showNetworkAlert, setShowNetworkAlert] = useState(false)
  const [lastActivity, setLastActivity] = useState(Date.now())
  const [isStatsVisible, setIsStatsVisible] = useState(false)
  const [apiStatus, setApiStatus] = useState({
    geolocation: false,
    network: false,
    canvas: false,
    intersectionObserver: false,
  })
  const [startTime, setStartTime] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const watchIdRef = useRef<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const statsObserverRef = useRef<IntersectionObserver | null>(null)
  const statsRef = useRef<HTMLDivElement>(null)
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Network Information API monitoring
  useEffect(() => {
    const updateNetworkStatus = () => {
      const connection =
        (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection

      setNetworkStatus({
        online: navigator.onLine,
        effectiveType: connection?.effectiveType,
        downlink: connection?.downlink,
      })

      // Show alert for poor network conditions
      if (
        connection &&
        (connection.effectiveType === "slow-2g" || connection.effectiveType === "2g" || connection.downlink < 0.5)
      ) {
        setShowNetworkAlert(true)
        setTimeout(() => setShowNetworkAlert(false), 5000)
      }
    }

    updateNetworkStatus()
    window.addEventListener("online", updateNetworkStatus)
    window.addEventListener("offline", updateNetworkStatus)

    const connection = (navigator as any).connection
    if (connection) {
      connection.addEventListener("change", updateNetworkStatus)
    }

    return () => {
      window.removeEventListener("online", updateNetworkStatus)
      window.removeEventListener("offline", updateNetworkStatus)
      if (connection) {
        connection.removeEventListener("change", updateNetworkStatus)
      }
    }
  }, [])

  // Intersection Observer for lazy loading stats
  useEffect(() => {
    if (statsRef.current) {
      statsObserverRef.current = new IntersectionObserver(
        ([entry]) => {
          setIsStatsVisible(entry.isIntersecting)
        },
        { threshold: 0.1 },
      )

      statsObserverRef.current.observe(statsRef.current)
    }

    return () => {
      if (statsObserverRef.current) {
        statsObserverRef.current.disconnect()
      }
    }
  }, [])

  // Add this useEffect after the existing useEffects to check API support
  useEffect(() => {
    setApiStatus({
      geolocation: "geolocation" in navigator,
      network: "connection" in navigator || "mozConnection" in navigator || "webkitConnection" in navigator,
      canvas: !!document.createElement("canvas").getContext,
      intersectionObserver: "IntersectionObserver" in window,
    })
  }, [])

  // Calculate distance between two positions using Haversine formula
  const calculateDistance = useCallback((pos1: Position, pos2: Position): number => {
    const R = 6371000 // Earth's radius in meters
    const dLat = ((pos2.lat - pos1.lat) * Math.PI) / 180
    const dLng = ((pos2.lng - pos1.lng) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pos1.lat * Math.PI) / 180) *
        Math.cos((pos2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }, [])

  // Update statistics
  const updateStats = useCallback(
    (newPositions: Position[]) => {
      const currentTime = Date.now()
      const duration = startTime ? (currentTime - startTime) / 1000 : 0

      if (newPositions.length < 2) {
        // Even with one position, we can show time and basic stats
        setStats((prev) => ({
          ...prev,
          duration,
          distance: 0,
          averageSpeed: 0,
          maxSpeed: 0,
          calories: 0,
        }))
        return
      }

      let totalDistance = 0
      let maxSpeed = 0

      for (let i = 1; i < newPositions.length; i++) {
        const distance = calculateDistance(newPositions[i - 1], newPositions[i])
        totalDistance += distance

        const timeDiff = (newPositions[i].timestamp - newPositions[i - 1].timestamp) / 1000 // seconds
        if (timeDiff > 0) {
          const speed = (distance / timeDiff) * 3.6 // km/h
          maxSpeed = Math.max(maxSpeed, speed)
        }
      }

      const averageSpeed = duration > 0 ? (totalDistance / duration) * 3.6 : 0
      const calories = Math.round(totalDistance * 0.05) // Rough estimate

      setStats({
        distance: totalDistance,
        duration,
        averageSpeed,
        maxSpeed,
        calories,
      })
    },
    [calculateDistance, startTime],
  )

  // Draw route on canvas
  const drawRoute = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw background grid for reference
    ctx.strokeStyle = "#f0f0f0"
    ctx.lineWidth = 1
    const gridSize = 20
    for (let x = 0; x <= canvas.width; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    for (let y = 0; y <= canvas.height; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }

    // If we have at least one position, show it
    if (positions.length === 0 && !currentPosition) {
      // Show "waiting for GPS" message
      ctx.fillStyle = "#666"
      ctx.font = "16px Arial"
      ctx.textAlign = "center"
      ctx.fillText("Waiting for GPS signal...", canvas.width / 2, canvas.height / 2)
      return
    }

    // Combine all positions (including current position if available)
    const allPositions = [...positions]
    if (
      currentPosition &&
      (positions.length === 0 ||
        positions[positions.length - 1].lat !== currentPosition.lat ||
        positions[positions.length - 1].lng !== currentPosition.lng)
    ) {
      allPositions.push(currentPosition)
    }

    if (allPositions.length === 0) return

    // Calculate bounds with minimum area for short distances
    const lats = allPositions.map((p) => p.lat)
    const lngs = allPositions.map((p) => p.lng)
    let minLat = Math.min(...lats)
    let maxLat = Math.max(...lats)
    let minLng = Math.min(...lngs)
    let maxLng = Math.max(...lngs)

    // Add padding for very small movements (less than ~10 meters)
    const latRange = maxLat - minLat
    const lngRange = maxLng - minLng
    const minRange = 0.0001 // roughly 10 meters

    if (latRange < minRange) {
      const center = (minLat + maxLat) / 2
      minLat = center - minRange / 2
      maxLat = center + minRange / 2
    }

    if (lngRange < minRange) {
      const center = (minLng + maxLng) / 2
      minLng = center - minRange / 2
      maxLng = center + minRange / 2
    }

    const padding = 40
    const width = canvas.width - 2 * padding
    const height = canvas.height - 2 * padding

    // Convert lat/lng to canvas coordinates
    const toCanvasCoords = (pos: Position) => ({
      x: padding + ((pos.lng - minLng) / (maxLng - minLng)) * width,
      y: padding + ((maxLat - pos.lat) / (maxLat - minLat)) * height,
    })

    // Draw route path if we have multiple positions
    if (allPositions.length > 1) {
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 4
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.beginPath()

      allPositions.forEach((pos, index) => {
        const coords = toCanvasCoords(pos)
        if (index === 0) {
          ctx.moveTo(coords.x, coords.y)
        } else {
          ctx.lineTo(coords.x, coords.y)
        }
      })
      ctx.stroke()

      // Draw direction arrows along the path
      if (allPositions.length > 1) {
        ctx.fillStyle = "#3b82f6"
        for (let i = 1; i < allPositions.length; i++) {
          const start = toCanvasCoords(allPositions[i - 1])
          const end = toCanvasCoords(allPositions[i])
          const angle = Math.atan2(end.y - start.y, end.x - start.x)

          // Draw small arrow at midpoint
          const midX = (start.x + end.x) / 2
          const midY = (start.y + end.y) / 2

          ctx.save()
          ctx.translate(midX, midY)
          ctx.rotate(angle)
          ctx.beginPath()
          ctx.moveTo(-5, -3)
          ctx.lineTo(5, 0)
          ctx.lineTo(-5, 3)
          ctx.closePath()
          ctx.fill()
          ctx.restore()
        }
      }
    }

    // Draw start point (green)
    if (allPositions.length > 0) {
      const startCoords = toCanvasCoords(allPositions[0])
      ctx.fillStyle = "#10b981"
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(startCoords.x, startCoords.y, 8, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()

      // Add "START" label
      ctx.fillStyle = "#10b981"
      ctx.font = "12px Arial"
      ctx.textAlign = "center"
      ctx.fillText("START", startCoords.x, startCoords.y - 15)
    }

    // Draw current position (red) - only if different from start
    if (currentPosition && allPositions.length > 0) {
      const currentCoords = toCanvasCoords(currentPosition)
      const startCoords = toCanvasCoords(allPositions[0])

      // Only draw if current position is different from start (moved at least a few pixels)
      const distance = Math.sqrt(
        Math.pow(currentCoords.x - startCoords.x, 2) + Math.pow(currentCoords.y - startCoords.y, 2),
      )
      if (distance > 5 || allPositions.length > 1) {
        ctx.fillStyle = "#ef4444"
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(currentCoords.x, currentCoords.y, 10, 0, 2 * Math.PI)
        ctx.fill()
        ctx.stroke()

        // Add pulsing effect for current position
        ctx.strokeStyle = "#ef4444"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(currentCoords.x, currentCoords.y, 15, 0, 2 * Math.PI)
        ctx.stroke()

        // Add "YOU" label
        ctx.fillStyle = "#ef4444"
        ctx.font = "12px Arial"
        ctx.textAlign = "center"
        ctx.fillText("YOU", currentCoords.x, currentCoords.y + 25)
      }
    }

    // Show distance info if we have movement
    if (allPositions.length > 1) {
      const totalDistance = stats.distance
      ctx.fillStyle = "#666"
      ctx.font = "14px Arial"
      ctx.textAlign = "left"
      ctx.fillText(`Distance: ${totalDistance}`, 10, 25)
      ctx.fillText(`Points: ${allPositions.length}`, 10, 45)
    }
  }, [positions, currentPosition, stats.distance])

  // Geolocation tracking
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by this browser.")
      return
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 1000, // use cached fix if it’s <1 s old
      timeout: 20000, // 20 s to acquire a first fix
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newPos: Position = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: Date.now(),
        }

        setCurrentPosition(newPos)
        setLastActivity(Date.now())

        if (state === "running") {
          setPositions((prev) => {
            const updated = [...prev, newPos]
            updateStats(updated)
            return updated
          })
        }
      },
      (error) => {
        console.error("Geolocation error:", error)
        if (error.code === error.TIMEOUT) {
          // Retry once with a fresh getCurrentPosition call
          navigator.geolocation.getCurrentPosition(
            () => {
              // Retry succeeded – restart watchPosition
              stopTracking()
              startTracking()
            },
            (err) => {
              console.error("Retry geolocation error:", err)
              alert("Unable to retrieve your location. Please ensure GPS is enabled and grant permission.")
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 },
          )
        } else {
          alert("Unable to retrieve your location. Please check your GPS settings.")
        }
      },
      options,
    )
  }, [state, updateStats])

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
  }, [])

  // Auto-pause detection
  useEffect(() => {
    if (state === "running") {
      const checkActivity = () => {
        const now = Date.now()
        if (now - lastActivity > 30000) {
          // 30 seconds of inactivity
          setState("paused")
          alert("Jogging paused due to inactivity. Tap Resume to continue.")
        }
      }

      timerRef.current = setInterval(checkActivity, 5000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current)
      }
    }
  }, [state, lastActivity])

  // Start/Resume jogging
  const startJogging = () => {
    setState("running")
    setLastActivity(Date.now())

    // Set start time if this is a new session
    if (positions.length === 0) {
      setStartTime(Date.now())
      startTracking()
    }

    // Start duration timer that updates every second
    durationTimerRef.current = setInterval(() => {
      if (startTime) {
        const currentDuration = (Date.now() - startTime) / 1000
        setStats((prev) => ({ ...prev, duration: currentDuration }))
      }
    }, 1000)
  }

  // Pause jogging
  const pauseJogging = () => {
    setState("paused")
    // Stop duration timer when paused
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }

  // Stop jogging
  const stopJogging = () => {
    setState("stopped")
    stopTracking()
    // Stop duration timer
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }

  // Reset session
  const resetSession = () => {
    setState("idle")
    setPositions([])
    setCurrentPosition(null)
    setStartTime(null)
    setStats({
      distance: 0,
      duration: 0,
      averageSpeed: 0,
      maxSpeed: 0,
      calories: 0,
    })
    stopTracking()
    // Clear duration timer
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }

  // Draw route when positions change
  useEffect(() => {
    drawRoute()
  }, [drawRoute])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const formatDistance = (meters: number) => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`
    }
    return `${(meters / 1000).toFixed(2)}km`
  }

  // Update stats every second when running
  useEffect(() => {
    if (state === "running" && startTime) {
      const statsUpdateInterval = setInterval(() => {
        updateStats(positions)
      }, 1000)

      return () => clearInterval(statsUpdateInterval)
    }
  }, [state, startTime, positions, updateStats])

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center justify-center gap-2">
            <span>🌳</span>
            Smart Outdoor Jogging Assistant
            <span>🏃‍♂️</span>
          </h1>
          <p className="text-gray-600">
            Real-time GPS tracking • Network monitoring • Canvas route visualization • Performance optimized
          </p>
        </div>

        {/* API Status Indicator */}
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-blue-800 text-lg">🔧 System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${apiStatus.geolocation ? "bg-green-500" : "bg-red-500"}`}></div>
                <span>GPS Tracking</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${apiStatus.network ? "bg-green-500" : "bg-red-500"}`}></div>
                <span>Network Monitor</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${apiStatus.canvas ? "bg-green-500" : "bg-red-500"}`}></div>
                <span>Route Drawing</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${apiStatus.intersectionObserver ? "bg-green-500" : "bg-red-500"}`}
                ></div>
                <span>Lazy Loading</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Network Status Alert */}
        {showNetworkAlert && (
          <Alert className="border-orange-200 bg-orange-50">
            <WifiOff className="h-4 w-4" />
            <AlertDescription>
              Poor network detected! You're entering a low-signal area. Consider staying in well-connected zones.
            </AlertDescription>
          </Alert>
        )}

        {/* Main Control Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Jogging Control</span>
              <Badge variant={networkStatus.online ? "default" : "destructive"} className="flex items-center gap-1">
                {networkStatus.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {networkStatus.online ? "Online" : "Offline"}
                {networkStatus.effectiveType && ` (${networkStatus.effectiveType})`}
              </Badge>
            </CardTitle>
            <CardDescription>
              Current Status: <Badge variant="outline">{state.charAt(0).toUpperCase() + state.slice(1)}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Control Buttons */}
            <div className="flex gap-2 justify-center">
              {state === "idle" && (
                <Button onClick={startJogging} className="flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  Start Jogging
                </Button>
              )}
              {state === "running" && (
                <Button onClick={pauseJogging} variant="outline" className="flex items-center gap-2 bg-transparent">
                  <Pause className="h-4 w-4" />
                  Pause
                </Button>
              )}
              {state === "paused" && (
                <Button onClick={startJogging} className="flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  Resume
                </Button>
              )}
              {(state === "running" || state === "paused") && (
                <Button onClick={stopJogging} variant="destructive" className="flex items-center gap-2">
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              )}
              {state === "stopped" && (
                <Button onClick={resetSession} variant="outline">
                  New Session
                </Button>
              )}
            </div>

            {/* Real-time Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <Clock className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                <div className="text-2xl font-bold text-blue-700">{formatTime(stats.duration)}</div>
                <div className="text-sm text-blue-600">Time</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <Route className="h-5 w-5 mx-auto mb-1 text-green-600" />
                <div className="text-2xl font-bold text-green-700">{stats.distance}</div>
                <div className="text-sm text-green-600">Distance</div>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <Zap className="h-5 w-5 mx-auto mb-1 text-purple-600" />
                <div className="text-2xl font-bold text-purple-700">{stats.averageSpeed.toFixed(1)}</div>
                <div className="text-sm text-purple-600">Avg Speed (km/h)</div>
              </div>
              <div className="text-center p-3 bg-orange-50 rounded-lg">
                <span className="text-lg mx-auto mb-1 block">🔥</span>
                <div className="text-2xl font-bold text-orange-700">{stats.calories}</div>
                <div className="text-sm text-orange-600">Calories</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Route Visualization */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Route Map
            </CardTitle>
            <CardDescription>
              Your jogging path is drawn in real-time
              {currentPosition &&
                ` • Current location: ${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <canvas
              ref={canvasRef}
              width={800}
              height={400}
              className="w-full h-64 md:h-96 border rounded-lg bg-gray-50"
            />
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                Start Point
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                Route Path
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                Current Position
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Detailed Stats Section (Lazy Loaded) */}
        <div ref={statsRef}>
          <Card>
            <CardHeader>
              <CardTitle>📊 Detailed Statistics</CardTitle>
              <CardDescription>
                {isStatsVisible ? "Statistics loaded and visible" : "Scroll to load detailed statistics"}
              </CardDescription>
            </CardHeader>
            {isStatsVisible && (
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg">Performance Metrics</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Total Distance:</span>
                        <span className="font-mono">{formatDistance(stats.distance)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Duration:</span>
                        <span className="font-mono">{formatTime(stats.duration)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Average Speed:</span>
                        <span className="font-mono">{stats.averageSpeed.toFixed(2)} km/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Max Speed:</span>
                        <span className="font-mono">{stats.maxSpeed.toFixed(2)} km/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Calories Burned:</span>
                        <span className="font-mono">{stats.calories} kcal</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg">Session Info</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Data Points:</span>
                        <span className="font-mono">{positions.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Network Status:</span>
                        <span className="font-mono">
                          {networkStatus.online ? "Connected" : "Offline"}
                          {networkStatus.effectiveType && ` (${networkStatus.effectiveType})`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>GPS Accuracy:</span>
                        <span className="font-mono">{currentPosition ? "High" : "Searching..."}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Auto-pause:</span>
                        <span className="font-mono">Enabled</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Session Status:</span>
                        <span className="font-mono capitalize">{state}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Start Time:</span>
                        <span className="font-mono">
                          {startTime ? new Date(startTime).toLocaleTimeString() : "Not started"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Safety Tips */}
        <Card className="bg-yellow-50 border-yellow-200">
          <CardHeader>
            <CardTitle className="text-yellow-800">🛡️ Safety Tips</CardTitle>
          </CardHeader>
          <CardContent className="text-yellow-700">
            <ul className="space-y-1 text-sm">
              <li>• Stay in well-lit, populated areas</li>
              <li>• Keep your phone charged for emergencies</li>
              <li>• The app will alert you about poor network areas</li>
              <li>• Auto-pause activates after 30 seconds of inactivity</li>
              <li>• Share your route with someone you trust</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
