// Curated trivia plus a bundled, attributed Open Trivia DB snapshot. No runtime API calls.
import openData from "./trivia-open-data.json" with { type: "json" };
export { TRIVIA_CATEGORIES } from "./trivia-categories.mjs";
import { TRIVIA_CATEGORIES } from "./trivia-categories.mjs";
export const TRIVIA_SOURCE = { name: "Open Trivia Database", url: "https://opentdb.com/", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" };

const questions = [
  ["science","Which planet is known as the Red Planet?",["Mars","Venus","Jupiter","Mercury"],0,"Iron-rich dust gives Mars its reddish appearance."],
  ["science","What gas do plants use during photosynthesis?",["Carbon dioxide","Oxygen","Helium"],0,"Plants use carbon dioxide during photosynthesis."],
  ["science","What is the chemical symbol for gold?",["Au","Ag","Go"],0,"Au comes from the Latin word aurum."],
  ["science","In a eukaryotic cell, where is most DNA stored?",["Nucleus","Ribosome","Cell wall"],0,"In eukaryotic cells, most DNA is in the nucleus."],
  ["science","How many legs does an insect have?",["Six","Eight","Ten"],0,"Insects have three pairs of legs."],
  ["science","What is the closest star to Earth?",["The Sun","Sirius","Proxima Centauri"],0,"The Sun is Earth's nearest star."],
  ["science","Which force pulls objects toward Earth?",["Gravity","Friction","Magnetism"],0,"Earth's gravity attracts objects toward its center."],
  ["science","What is H2O commonly called?",["Water","Hydrogen","Salt"],0,"A water molecule has two hydrogen atoms and one oxygen atom."],
  ["science","Which organ pumps blood around the human body?",["Heart","Liver","Lung"],0,"The heart circulates blood through the body."],
  ["science","Which mineral is hardest on the Mohs scale?",["Diamond","Quartz","Topaz"],0,"Diamond is the hardest naturally occurring mineral on the Mohs scale."],
  ["science","What do bees collect from flowers to make honey?",["Nectar","Pollen only","Sap"],0,"Bees turn flower nectar into honey."],
  ["science","Which planet has the most prominent ring system?",["Saturn","Earth","Mars"],0,"Saturn's bright rings are made mostly of ice and rock."],
  ["science","What is the boiling point of water at sea level?",["100°C","50°C","150°C"],0,"At standard atmospheric pressure, water boils at 100°C."],
  ["science","Which blood cells help fight infection?",["White blood cells","Red blood cells","Platelets"],0,"White blood cells are key parts of the immune system."],
  ["science","What type of animal is a salmon?",["Fish","Amphibian","Mammal"],0,"Salmon are fish that typically migrate between rivers and sea."],
  ["world","What is the capital of Japan?",["Tokyo","Kyoto","Osaka"],0,"Tokyo is Japan's capital and largest metropolitan area."],
  ["world","Which ocean lies between Africa and Australia?",["Indian Ocean","Atlantic Ocean","Arctic Ocean"],0,"The Indian Ocean separates eastern Africa from western Australia."],
  ["world","Which country is home to the city of Marrakech?",["Morocco","Egypt","Portugal"],0,"Marrakech is a major city in Morocco."],
  ["world","What is the largest continent by area?",["Asia","Africa","Europe"],0,"Asia is the largest continent by both area and population."],
  ["world","Which river flows through Paris?",["Seine","Danube","Thames"],0,"The Seine runs through the heart of Paris."],
  ["world","On which continent is the Sahara Desert?",["Africa","Asia","South America"],0,"The Sahara spans much of northern Africa."],
  ["world","Which country has a maple leaf on its flag?",["Canada","Austria","Denmark"],0,"Canada's national flag features a red maple leaf."],
  ["world","What is the capital of Kenya?",["Nairobi","Lagos","Accra"],0,"Nairobi is Kenya's capital city."],
  ["world","Which sea separates Europe and Africa?",["Mediterranean Sea","Baltic Sea","Caribbean Sea"],0,"The Mediterranean lies between southern Europe and northern Africa."],
  ["world","The Great Barrier Reef is off the coast of which country?",["Australia","India","Mexico"],0,"The reef lies in the Coral Sea off northeastern Australia."],
  ["world","Which mountain range includes Mount Everest?",["Himalayas","Andes","Alps"],0,"Everest is in the Himalayas on the Nepal-China border."],
  ["world","What is the capital of Iceland?",["Reykjavík","Oslo","Helsinki"],0,"Reykjavík is Iceland's capital."],
  ["world","Which country is shaped like a boot?",["Italy","Greece","Chile"],0,"The Italian peninsula is commonly compared to a boot."],
  ["world","Which language is primarily spoken in Brazil?",["Portuguese","Spanish","French"],0,"Brazil was colonized by Portugal, so Portuguese is its official language."],
  ["world","What is the smallest independent country by area?",["Vatican City","Monaco","Malta"],0,"Vatican City is the world's smallest sovereign state by area."],
  ["arts","Who painted the Mona Lisa?",["Leonardo da Vinci","Claude Monet","Pablo Picasso"],0,"Leonardo da Vinci painted the portrait in the early 1500s."],
  ["arts","Which instrument has 88 keys on a standard model?",["Piano","Violin","Flute"],0,"A modern standard piano has 88 keys."],
  ["arts","Who wrote the play Romeo and Juliet?",["William Shakespeare","Jane Austen","Charles Dickens"],0,"Shakespeare wrote the tragedy in the late 16th century."],
  ["arts","Which art movement is Claude Monet associated with?",["Impressionism","Cubism","Surrealism"],0,"Monet was a leading French Impressionist painter."],
  ["arts","What is the name of the cowboy in Toy Story?",["Woody","Buzz","Rex"],0,"Woody is the pull-string cowboy toy in Toy Story."],
  ["arts","Which composer wrote The Four Seasons?",["Antonio Vivaldi","Johann Bach","Franz Schubert"],0,"Vivaldi composed the set of violin concertos around 1720."],
  ["arts","In film, what does CGI stand for?",["Computer-generated imagery","Color grading index","Camera guide input"],0,"CGI means computer-generated imagery."],
  ["arts","Who sculpted the marble David completed in 1504?",["Michelangelo","Donatello","Bernini"],0,"Michelangelo carved the marble David, completed in 1504."],
  ["arts","Which instrument is Yo-Yo Ma known for playing?",["Cello","Trumpet","Harp"],0,"Yo-Yo Ma is a renowned cellist."],
  ["arts","Which Tolkien book was published in 1937?",["The Hobbit","The Silmarillion","The Two Towers"],0,"J. R. R. Tolkien's The Hobbit was published in 1937."],
  ["arts","Which dance style originated in Argentina and Uruguay?",["Tango","Waltz","Flamenco"],0,"Tango developed in the Río de la Plata region."],
  ["arts","Who created the comic character Spider-Man?",["Stan Lee and Steve Ditko","Jack Kirby and Joe Simon","Bill Finger and Bob Kane"],0,"Spider-Man debuted in a story created by Lee and Ditko."],
  ["arts","Which color is made by mixing blue and yellow paint?",["Green","Purple","Orange"],0,"In traditional pigment mixing, blue and yellow make green."],
  ["arts","What is the name of the fairy in Peter Pan?",["Tinker Bell","Thumbelina","Wendy"],0,"Tinker Bell is Peter Pan's fairy companion."],
  ["arts","Which novel features the ship Pequod?",["Moby-Dick","Treasure Island","The Old Man and the Sea"],0,"The Pequod is the whaling ship in Herman Melville's Moby-Dick."],
  ["numbers","What is 9 × 7?",["63","56","72"],0,"Nine groups of seven make sixty-three."],
  ["numbers","How many sides does a hexagon have?",["Six","Five","Eight"],0,"The prefix hexa- means six."],
  ["numbers","What is half of 3/4?",["3/8","1/2","2/3"],0,"Half of three quarters is three eighths."],
  ["numbers","What is the next prime number after 7?",["11","9","13"],0,"Eleven is prime; nine is divisible by three."],
  ["numbers","How many degrees are in a right angle?",["90","45","180"],0,"A right angle measures 90 degrees."],
  ["numbers","What is 15% of 200?",["30","20","45"],0,"Ten percent is 20 and five percent is 10; together that is 30."],
  ["numbers","How many zeros are in one million?",["Six","Five","Seven"],0,"One million is written 1,000,000."],
  ["numbers","What is the Roman numeral for 50?",["L","C","D"],0,"In Roman numerals, L represents fifty."],
  ["numbers","What is 2 to the power of 5?",["32","10","25"],0,"2 × 2 × 2 × 2 × 2 equals 32."],
  ["numbers","How many months have 31 days?",["Seven","Six","Eight"],0,"January, March, May, July, August, October, and December have 31 days."],
  ["numbers","What is the perimeter of a 4-by-3 rectangle?",["14","12","7"],0,"The perimeter is 4 + 3 + 4 + 3, which equals 14."],
  ["numbers","Which fraction is equal to 0.5?",["1/2","1/3","2/5"],0,"One half written as a decimal is 0.5."],
  ["numbers","What is the square root of 81?",["9","8","7"],0,"Nine multiplied by nine equals eighty-one."],
  ["numbers","How many minutes are in 2.5 hours?",["150","125","180"],0,"Two hours is 120 minutes and half an hour is 30."],
  ["numbers","What is the smallest three-digit number?",["100","101","999"],0,"Counting reaches 100 immediately after 99."],
];

const curatedCategoryIds = { science: "opentdb-17", world: "opentdb-22", arts: "opentdb-25", numbers: "opentdb-19" };
const curatedQuestions = questions.map(([category, question, choices, correctIndex, explanation], index) => ({
  id: `curated-${category}-${index + 1}`, category: curatedCategoryIds[category], question, choices, correctIndex, explanation, difficulty: "mixed", source: "curated",
}));
const normalizeQuestion = value => value.normalize("NFKD").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const knownQuestions = new Set(curatedQuestions.map(item => normalizeQuestion(item.question)));
const importedQuestions = openData.questions
  .filter(item => { const normalized = normalizeQuestion(item.question); if (knownQuestions.has(normalized)) return false; knownQuestions.add(normalized); return true; })
  .map(item => ({ ...item, source: item.source || TRIVIA_SOURCE.name }));
export const TRIVIA_QUESTIONS = [...curatedQuestions, ...importedQuestions];

export function getTriviaQuestions(category = "mixed") {
  return TRIVIA_QUESTIONS.filter(item => category === "mixed" || item.category === category);
}

function shuffled(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Each returned question has independently shuffled choices and a remapped correctIndex.
export function createTriviaDeck(category = "mixed", rng = Math.random) {
  return shuffled(getTriviaQuestions(category), rng).map(item => {
    const order = shuffled(item.choices.map((_, index) => index), rng);
    return { ...item, choices: order.map(index => item.choices[index]), correctIndex: order.indexOf(item.correctIndex) };
  });
}
