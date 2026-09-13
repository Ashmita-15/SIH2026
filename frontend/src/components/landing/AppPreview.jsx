import React from 'react'
import heroVideo from '../../assets/images/video.mp4'

/**
 * Product preview showing the uploaded video clip playing continuously in an infinite loop
 * inside the mobile device shell.
 */
export default function AppPreview() {
  return (
    <div className="relative mx-auto w-[268px] sm:w-[300px]">
      <div
        aria-hidden="true"
        className="absolute -inset-10 rounded-full blur-3xl opacity-60"
        style={{ background: 'radial-gradient(circle, rgba(79,176,175,.55), transparent 68%)' }}
      />

      <div className="device relative animate-float overflow-hidden">
        <video
          src={heroVideo}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className="w-full h-auto block rounded-[1.3rem] object-cover scale-[1.15] origin-top"
        />
      </div>
    </div>
  )
}
