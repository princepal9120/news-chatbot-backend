
const NewsIngestionService = require('./NewsIngestionService');
const SessionService = require('./SessionService');
const { model } = require('../config/gemini');
const logger = require('../utils/logger');

class ChatService {
    constructor() {
        this.newsService = new NewsIngestionService();
        this.sessionService = new SessionService();
        this.model = model;
    }

    async processQuery(sessionId, userMessage) {
        try {
            // Retrieve relevant news passages
            const relevantNews = await this.newsService.searchSimilar(userMessage, 5);

            // Get recent chat history for context
            const history = await this.sessionService.getSessionHistory(sessionId, 10);

            // Check if we found relevant articles
            if (relevantNews.length === 0) {
                const response = "I don't have any recent news articles that match your query. Please try asking about different topics or check back later as I regularly update my news database.";

                await this.sessionService.addMessage(sessionId, 'user', userMessage);
                await this.sessionService.addMessage(sessionId, 'bot', response);

                return {
                    role: 'bot',
                    content: response,
                    sources: []
                };
            }

            // Build context for Gemini
            const newsContext = relevantNews.map((news, index) =>
                `Article ${index + 1} [${news.source} - ${news.category?.toUpperCase() || 'NEWS'} - ${new Date(news.publishedAt).toLocaleDateString()}]:
Title: ${news.title}
Content: ${news.content}`
            ).join('\n\n');

            const conversationHistory = history.slice(-5).map(msg =>
                `${msg.role}: ${msg.content}`
            ).join('\n');

            // Detect query type for better responses
            const queryLower = userMessage.toLowerCase();
            const isSportsQuery = ['sport', 'sports', 'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'hockey', 'olympics', 'nfl', 'nba', 'mlb'].some(term => queryLower.includes(term));

            const prompt = `
You are a helpful news assistant. Answer the user's question based on the following recent news articles and conversation history.

Recent News Articles (${relevantNews.length} articles found):
${newsContext}

Recent Conversation:
${conversationHistory}

User Question: ${userMessage}

Instructions:
- Provide accurate information based ONLY on the news articles provided above
- If you found relevant articles, use them to answer the question thoroughly
- ${isSportsQuery ? 'Focus on sports-related content and provide detailed sports information' : 'Provide comprehensive coverage of the topic'}
- Be specific and cite information from the articles
- If the articles don't fully answer the question, mention what information is available
- Include relevant details like dates, sources, and key facts
- Be engaging and informative
- Always mention the category of news (e.g., SPORTS, TECH, POLITICS) when relevant

Answer:`;

            const result = await this.model.generateContent(prompt);
            const response = result.response.text();

            // Store both user message and bot response
            await this.sessionService.addMessage(sessionId, 'user', userMessage);
            await this.sessionService.addMessage(sessionId, 'bot', response);

            logger.info(`Processed query for session ${sessionId}`);

            return {
                role: 'bot',
                content: response,
                sources: relevantNews.map(news => ({
                    title: news.title,
                    url: news.url,
                    source: news.source,
                    category: news.category
                }))
            };
        } catch (error) {
            logger.error('Error generating response:', error);
            throw new Error('Failed to generate response');
        }
    }
}

module.exports = ChatService;
