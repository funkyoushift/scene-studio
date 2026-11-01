import { validateExperience } from "./experience.mjs";
const button = (id, label, y, actions, when = []) => ({
  id,
  kind: "button",
  label,
  x: 12,
  y,
  width: 76,
  height: 17,
  background: "#4338ca",
  actions,
  when,
});
const page = (id, title, description, elements, extra = {}) => ({
  id,
  title,
  description,
  background: "#141b32",
  elements,
  ...extra,
});
export const EXPERIENCE_EXAMPLES = [
  {
    id: "story",
    name: "Branching story",
    description: "A remembered decision changes the choices at the ending.",
  },
  {
    id: "sequence",
    name: "Sequence puzzle",
    description: "Clickable symbols, a score, retry paths, and a countdown.",
  },
];
export function experienceExample(
  kind,
  id = `experience-${crypto.randomUUID()}`,
) {
  const base = {
    kind: "experience",
    version: 1,
    id,
    enabled: true,
    assets: [],
    saveProgress: false,
    start: "start",
  };
  if (kind === "story")
    return validateExperience({
      ...base,
      name: "The observatory signal",
      variables: [{ id: "trusted_visitor", initial: false }],
      scenes: [
        page(
          "start",
          "An unexpected visitor",
          "A stranger arrives at the observatory with a warning. What do you do?",
          [
            button("trust", "Let them help", 25, [
              { type: "set", variable: "trusted_visitor", value: true },
              { type: "goto", scene: "signal" },
            ]),
            button("alone", "Investigate alone", 55, [
              { type: "goto", scene: "signal" },
            ]),
          ],
        ),
        page(
          "signal",
          "The signal returns",
          "The transmitter is failing. Your earlier choice changes what you can do now.",
          [
            button(
              "together",
              "Repair it together",
              25,
              [{ type: "goto", scene: "together" }],
              [{ variable: "trusted_visitor", op: "eq", value: true }],
            ),
            button("solo", "Send a final warning", 55, [
              { type: "goto", scene: "alone" },
            ]),
          ],
        ),
        page(
          "together",
          "A new alliance",
          "Together, you save the transmitter. The next chapter is yours to write.",
          [button("restart", "Try another path", 65, [{ type: "restart" }])],
        ),
        page(
          "alone",
          "A warning in the dark",
          "Your message gets through, but the observatory falls silent.",
          [button("restart", "Try another path", 65, [{ type: "restart" }])],
        ),
      ],
    });
  if (kind === "sequence")
    return validateExperience({
      ...base,
      name: "Signal lock",
      variables: [{ id: "score", initial: 0 }],
      scenes: [
        page(
          "start",
          "Remember the signal",
          "SUN → MOON → STAR. Select Begin when you are ready.",
          [button("begin", "Begin", 65, [{ type: "goto", scene: "first" }])],
        ),
        ...["first", "second", "third"].map((id, index) =>
          page(
            id,
            `Signal ${index + 1} of 3`,
            "Choose the next symbol. Score: {score}",
            ["SUN", "MOON", "STAR"].map((symbol, j) =>
              button(
                `choice-${j}`,
                symbol,
                12 + j * 26,
                index === j
                  ? [
                      { type: "add", variable: "score", value: 1 },
                      {
                        type: "goto",
                        scene: ["second", "third", "win"][index],
                      },
                    ]
                  : [{ type: "goto", scene: "retry" }],
              ),
            ),
            {
              timer: {
                seconds: 20,
                actions: [{ type: "goto", scene: "retry" }],
              },
            },
          ),
        ),
        page(
          "win",
          "Signal accepted",
          "You unlocked the signal. Final score: {score}",
          [button("again", "Play again", 65, [{ type: "restart" }])],
        ),
        page(
          "retry",
          "Try a new attempt",
          "The sequence broke or time ran out. Score: {score}",
          [button("again", "Review the sequence", 65, [{ type: "restart" }])],
        ),
      ],
    });
  throw new Error("Choose a supported example.");
}
