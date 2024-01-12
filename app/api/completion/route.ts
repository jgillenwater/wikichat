import Bugsnag from "@bugsnag/js";
import { AstraDB } from "@datastax/astra-db-ts";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { OpenAI } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";

const {
  ASTRA_DB_APPLICATION_TOKEN,
  ASTRA_DB_ENDPOINT,
  ASTRA_DB_SUGGESTIONS_COLLECTION,
  BUGSNAG_API_KEY,
  OPENAI_API_KEY,
} = process.env;

const astraDb = new AstraDB(ASTRA_DB_APPLICATION_TOKEN, ASTRA_DB_ENDPOINT);

const template = `You are an assistant who creates sample questions to ask a chatbot.
Given the context below of the most recently added data to the most popular pages on Wikipedia come up with 4 suggested questions
Make the suggested questions on a variety of topics 
keep them to less than 12 words each
Do not number the questions 
Do not add quotes around the questions

<context>
  {context}
</context>`;

const prompt = PromptTemplate.fromTemplate(template);

// const openai = new ChatOpenAI({
//   modelName: 'gpt-3.5-turbo',
//   temperature: 1.5,
//   openAIApiKey: OPENAI_API_KEY,
//   streaming: true,
// });

const openai = new OpenAI({
  modelName: 'gpt-3.5-turbo-instruct',
  temperature: 1.5,
  openAIApiKey: OPENAI_API_KEY,
  streaming: true,
});

export async function POST(req: Request) {
  try {
    let docContext = "";

    try {
      const suggestionsCollection = await astraDb.collection(ASTRA_DB_SUGGESTIONS_COLLECTION);

      const suggestionsCursor = suggestionsCollection.find(
        {
          _id: "recent_articles"
        },
        {
          projection: {
            "recent_articles.metadata.title" : 1,
            "recent_articles.suggested_chunks.content" : 1
          },
        });

      const suggestionsDocuments = await suggestionsCursor.toArray();

      const docsMap = suggestionsDocuments?.map(doc => { 
        return {
          title: doc.recent_articles[0].metadata.title, 
          content: doc.recent_articles[0].suggested_chunks.map(chunk => chunk.content)
        }
      });
      
      docContext = JSON.stringify(docsMap);

    } catch (e) {
      console.log("Error querying db...");
    }

    // const parser = new JsonOutputFunctionsParser();

    // const extractionFunctionSchema = {
    //   name: "extractor",
    //   description: "Extracts fields from the input.",
    //   parameters: {
    //     type: "object",
    //     properties: {
    //       question1: {
    //         type: "string",
    //         description: "The first suggested question",
    //       },
    //       question2: {
    //         type: "string",
    //         description: "The second suggested question",
    //       },
    //       question3: {
    //         type: "string",
    //         description: "The third suggested question",
    //       },
    //       question4: {
    //         type: "string",
    //         description: "The fourth suggested question",
    //       },
    //     },
    //     required: ["question1", "question2", "question3", "question4"],
    //   },
    // };

    // const response = await openai.chat.completions.create(
    //   {
    //     model: "gpt-3.5-turbo",
    //     stream: true,
    //     temperature: 1.5,
    //     messages: [{
    //       role: "user",
    //       content: `You are an assistant who creates sample questions to ask a chatbot.
    //       Given the context below of the most recently added data to the most popular pages on Wikipedia come up with 4 suggested questions
    //       Make the suggested questions on a variety of topics and keep them to less than 12 words each

    //       START CONTEXT
    //       ${docContext}
    //       END CONTEXT
    //       `,
    //     }],
    //   }
    // );
    // const stream = OpenAIStream(response);

    // const runnable = openai
    //   .bind({
    //     functions: [extractionFunctionSchema],
    //     function_call: { name: "extractor" },
    //   })
    //   .pipe(parser);

    // const chain = RunnableSequence.from([
    //   prompt,
    //   runnable,
    //   new BytesOutputParser(),
    // ]);
    
    // const stream = await chain.stream({
    //   context: docContext,
    // });

    // const runnable = prompt.pipe(openai);

    const chain = RunnableSequence.from([
      prompt,
      openai,
      new StringOutputParser(),
    ]);

    const stream = await chain.stream({
      context: docContext,
    });

    return new StreamingTextResponse(stream);
  } catch (e) {
    if (BUGSNAG_API_KEY) {
      Bugsnag.notify(e);
    }
    throw e;
  }
}