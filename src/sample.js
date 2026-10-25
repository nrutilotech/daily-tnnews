// Dummy edition used only by `node src/main.js sample` to check the slide design.
// Every headline says SAMPLE so it can never be mistaken for real news.
const s = (category, headline, summary, key_fact = "") => ({
  category,
  headline: `SAMPLE: ${headline}`,
  summary,
  key_fact,
  caption_line: `SAMPLE: ${headline}`,
  source_name: "Sample Source",
  source_url: "https://example.com",
  image_query: category,
});

export const SAMPLE_EDITION = {
  edition_summary: "This is placeholder text used to preview the slide design. It is not news.",
  stories: [
    s("Government", "State announces a new welfare scheme for rural households", "Placeholder summary text showing how two or three short sentences look on the cover slide. Real posts use facts from news sources.", "Placeholder key fact"),
    s("Weather", "Heavy rain alert for coastal districts over the next two days", "Placeholder summary text that wraps across a few lines so the layout can be checked for spacing and readability on a phone.", "Orange alert · 2 days"),
    s("Sports", "Chennai side wins a close league match at home", "Placeholder summary text for a sports story. It keeps to the same length limits as the real stories Claude writes.", ""),
    s("Business", "New electronics plant planned near the city with thousands of jobs", "Placeholder summary text for a business story with an investment figure and a timeline mentioned here.", "₹1,000 crore · 5,000 jobs"),
    s("Education", "Board exam timetable released for higher secondary students", "Placeholder summary text for an education story about dates and what students need to do next.", "Exams from March"),
    s("Health", "District hospitals to get new emergency care units", "Placeholder summary text for a health story describing where the units come up and when they open.", ""),
    s("Agriculture", "Water released from reservoir for delta irrigation", "Placeholder summary text for an agriculture story about the release quantity and the acreage it covers.", "10,000 cusecs"),
    s("Transport", "Metro rail extends service hours on weekends", "Placeholder summary text for a transport story covering the new timings and the stretches affected.", "Till 11 PM"),
    s("Technology", "State launches an online portal for certificates", "Placeholder summary text for a technology story explaining which services moved online.", ""),
    s("Environment", "Beach clean-up drive collects tonnes of plastic waste", "Placeholder summary text for an environment story with a short, simple description of what happened.", "12 tonnes"),
  ],
  hashtags: ["TamilNadu", "TNNews", "Chennai", "DailyTNNews"],
};
