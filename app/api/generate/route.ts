import { generateText, Output } from "ai"
import { z } from "zod"

export const maxDuration = 120

const courseSchema = z.object({
  title: z.string().describe("Concise course title"),
  summary: z.string().describe("One or two sentence summary of the course"),
  material: z
    .array(z.object({ h: z.string().describe("Section heading"), p: z.string().describe("Section body, clear and accurate, 80-180 words") }))
    .describe("4 to 6 study material sections"),
  quiz: z
    .array(
      z.object({
        q: z.string().describe("Question text"),
        o: z.array(z.string()).describe("Exactly 4 answer options"),
        a: z.number().int().describe("Index (0-3) of the correct option"),
      }),
    )
    .describe("8 multiple-choice questions that test the study material"),
  assignment: z.object({ title: z.string(), task: z.string().describe("Clear instructions for a short written assignment") }),
  svg: z
    .string()
    .describe(
      'Self-contained educational diagram as SVG markup with viewBox="0 0 600 340", white background rect, clear labels, no scripts, no external references, no foreignObject',
    ),
})

const requestSchema = z.object({
  topic: z.string().trim().min(2).max(200),
  subject: z.string().trim().max(100).optional().default(""),
})

function sanitizeSvg(svg: string) {
  const match = svg.match(/<svg[\s\S]*<\/svg>/i)
  if (!match) return ""
  return match[0]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*(?!#)[^"']*\2/gi, "")
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Please enter a topic (2-200 characters)." }, { status: 400 })
  }
  const { topic, subject } = parsed.data

  try {
    const { output } = await generateText({
      model: "anthropic/claude-sonnet-5.5",
      output: Output.object({ schema: courseSchema }),
      system:
        "You are an expert teacher who writes accurate, age-appropriate mini-courses for school and college students. Material must be factually correct and the quiz must be answerable from the material.",
      prompt: `Create a complete mini-course on: "${topic}".${subject ? ` Subject: ${subject}.` : ""}`,
    })

    const quiz = output.quiz
      .filter((q) => q.o.length >= 4)
      .map((q) => ({ q: q.q, o: q.o.slice(0, 4), a: Math.min(3, Math.max(0, Math.round(q.a))) }))

    return Response.json({ ...output, quiz, svg: sanitizeSvg(output.svg) })
  } catch (error) {
    console.error("Course generation failed:", error)
    const err = error as { message?: string; responseBody?: string; cause?: { responseBody?: string } }
    const details = [err?.message, err?.responseBody, err?.cause?.responseBody].join(" ")
    if (/customer_verification_required|credit card/i.test(details)) {
      return Response.json(
        { error: "AI Gateway needs a credit card on your Vercel team to unlock free credits (Vercel dashboard → AI)." },
        { status: 503 },
      )
    }
    return Response.json({ error: "AI generation failed. Please try again." }, { status: 500 })
  }
}
