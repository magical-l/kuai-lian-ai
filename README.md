# <a id="中文版本"></a>快<del style="color:gray">恋爱</del>连AI

作者：我

[中文](#中文版本) | [English](#english)

---

快连AI是一款极致小巧的小工具，主要用于快速添加和管理大模型服务端点、快速测试连接、简单对话。端点信息、会话记录完全存于你电脑本地，不会翻本地文件（由浏览器严格把关），也不会联网泄漏。

* 只有一个html文件，多的都是假货。
* 使用前先让你的ai审查一下有没有被夹带私货。

## 选目录

首次打开页面需选择一个本地文件夹做工作目录，端点信息、会话记录将保存于该目录，随时可换，可自己在操作系统里查看、备份。

后续重新打开页面可能会需要重新确认一下该目录（浏览器干的）。

## 左侧栏：管理端点

端点是线上部署的大模型服务。不同端点有不同地址，同一模型可部署在多个地址，成为不同端点。
- 目前支持OpenAI、Claude、Gemini三种接口格式。国产大模型基本都是OpenAI格式。
- 不支持的格式快来贡献代码。

一个端点可以提供多个模型。

可以测试连接模型，也可以测试一个端点下添加的所有模型。

- 有些服务端点没开CORS，浏览器访问会被拒。我们区分了这种情况，免得以为是服务挂了。

## 中间：聊天

可以选择一个或多个端点舌战群儒。

交谈中可以随时加入未选端点，或移除已选端点（踢出群！）。

- 目前多轮对话只会把你的话和该模型之前的回复作为上下文，不搭理其他模型。

## 右侧栏：会话记录

可收起，眼不见为净。

点击旧会话可再续前缘。

---

# <a id="english"></a>kuai lian AI

[中文](#中文版本) | [English](#english)

basically translated by GLM5

Kuai Lian AI (means quick link to AI) is an ultra-lightweight tool for quickly adding and managing LLM service endpoints, testing connections, and simple chatting. Endpoint info and conversation records are stored entirely on your local computer—no local file access (guarded by the browser), no network leakage.

* Just one HTML file—anything else is fake.
* Let your AI review it for hidden malicious code before use.

## Choose Directory

On first launch, select a local folder as your working directory. Endpoint info and conversation records will be saved there. You can change it anytime and view/backup it directly in your OS.

When reopening the page later, you may need to re-confirm the directory (browser behavior).

## Left Sidebar: Manage Endpoints

Endpoints are deployed LLM services online. Different endpoints have different addresses; the same model can be deployed at multiple addresses as different endpoints.
- Currently supports OpenAI, Claude, and Gemini API formats. Most Chinese LLMs use OpenAI format.
- Unsupported formats? Come contribute code!

One endpoint can provide multiple models.

You can test connection to a model, or test all models under an endpoint.

- Some service endpoints don't enable CORS, so browser access gets blocked. We distinguish this case so you don't mistake it for service being down.

## Center: Chat

Select one or multiple endpoints to chat together.

During conversation, you can add unselected endpoints or remove selected ones (kick them out!) anytime.

- Currently, multi-turn conversations only use your messages and that model's previous replies as context, ignoring other models.

## Right Sidebar: Conversation History

Collapsible—out of sight, out of mind.

Click an old conversation to continue where you left off.