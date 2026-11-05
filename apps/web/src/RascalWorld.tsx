/** The paper world is decorative. It never intercepts a wallet or draw action. */
export function RascalMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M9 29 5 12l18 10c9-5 18-5 27 1l10-8-3 23c4 13-7 22-24 22C15 60 5 48 9 29Z"
        fill="#e2fa62"
        stroke="#282338"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M14 22c-2-15 23-21 34-12l6 15-40-3Z"
        fill="#6789ff"
        stroke="#282338"
        strokeWidth="3"
      />
      <path
        d="m29 22 31 2-4 7-27-5"
        fill="#ff9389"
        stroke="#282338"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="m18 36 9-2m12 0 8 3M24 46c7 5 15 4 20-1"
        fill="none"
        stroke="#282338"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m32 48 4 1-3 5Z"
        fill="#fffdf2"
        stroke="#282338"
        strokeWidth="1.5"
      />
    </svg>
  );
}
export function RascalWorld() {
  return (
    <div className="rascal-world" aria-hidden="true">
      <svg className="paper-doodle doodle-star" viewBox="0 0 120 120">
        <path
          d="m59 7 12 34 37-3-28 25 15 34-35-17-29 26 5-39L7 46l38-5Z"
          fill="#ffadbd"
          stroke="#30243b"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="m50 55 7 3m11-7 6 3m-20 12q12 10 21-3"
          fill="none"
          stroke="#30243b"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <svg className="paper-doodle doodle-dice" viewBox="0 0 120 120">
        <path
          d="m20 22 67-9 17 74-73 18Z"
          fill="#bdb0ff"
          stroke="#30243b"
          strokeWidth="3"
        />
        <g fill="#30243b">
          <circle cx="43" cy="42" r="6" />
          <circle cx="78" cy="37" r="6" />
          <circle cx="63" cy="60" r="6" />
          <circle cx="47" cy="83" r="6" />
          <circle cx="84" cy="77" r="6" />
        </g>
      </svg>
      <svg className="paper-doodle doodle-arrow" viewBox="0 0 150 160">
        <path
          d="M27 14c105 6 93 126 26 107-48-13-17-78 41-54m-24-21 27 21-29 16"
          stroke="#4269e1"
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg className="paper-doodle doodle-crayon" viewBox="0 0 160 80">
        <path
          d="m13 38 31-21 99 13-4 35-99-13Z"
          fill="#ff967b"
          stroke="#30243b"
          strokeWidth="3"
        />
        <path d="m13 38 17-11-3 17Z" fill="#30243b" />
        <path d="m58 19-4 35m66-27-4 35" stroke="#30243b" strokeWidth="3" />
        <path d="m70 35 33 4m-34 7 26 4" stroke="#ffe8a6" strokeWidth="5" />
      </svg>
      <span className="paper-scribble scribble-one">
        a little
        <br />
        chaos :)
      </span>
      <span className="paper-scribble scribble-two">oops!</span>
      <span className="paper-cross cross-one">✳</span>
      <span className="paper-cross cross-two">✳</span>
    </div>
  );
}
export function RascalStickers() {
  return (
    <div className="rascal-stage-art" aria-hidden="true">
      <span className="rascal-tape tape-left" />
      <span className="rascal-tape tape-right" />
      <img
        className="rascal-mascot"
        src="/brands/rascals/rascal-mascot.png"
        alt=""
      />
      <span className="rascal-caption">
        professional
        <br />
        bad influence
      </span>
      <span className="sticker-label">100% rascal energy</span>
      <svg className="cage-scribble" viewBox="0 0 220 55">
        <path
          d="M7 38c32-39 34-19 54-22 40-6 55 43 141 7m-23-10 28 10-20 16"
          fill="none"
          stroke="#ef7867"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
