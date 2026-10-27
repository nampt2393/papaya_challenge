# Approach
Khi làm việc với AI agent, tôi dùng các bộ skill có quy trình sẵn như Superpowers hoặc BMAD Method, thay vì để agent viết code ngay.
Tôi tập trung vào việc brainstorm. plan để chốt các quyết định quan trọng, rồi review kỹ spec và plan mà agent tạo ra trước khi cho AI agent code.
Sau khi code được tạo ra tôi kiểm tra lại bằng cách test và review + run skill review code để tìm kiếm các issues, vá các lỗi phát sinh trước khi commit.
# Key Decisions
## Where will the SDK run?
Tôi chọn chỉ Node.js thay vì phương án được gợi ý (Node.js + browser), vì lý do bảo mật.

API key không thể giấu trên browser. Bất cứ credential nào browser dùng để gọi API thì người dùng đều xem được qua DevTools, dù nó nằm trong bundle hay được lấy lúc runtime. Đây là key cấp partner: ai lấy được thì đọc được claim của mọi khách hàng của partner, tạo được claim giả, và truy cập được tài liệu y tế.
API chỉ xác thực partner, không xác thực người dùng cuối. Việc mỗi người dùng chỉ thấy claim của mình là trách nhiệm của backend partner. Vì vậy mô hình đúng là browser → backend partner → SDK → Insurance API, với key không bao giờ rời khỏi server.
Lợi ích phụ: chỉ một transport (node:http) để viết và test, và đếm được từng byte khi upload để báo tiến độ.
Nếu sau này cần upload trực tiếp từ browser, hướng đi là để backend partner cấp token ngắn hạn, giới hạn quyền (vd. chỉ upload cho một claim), hoặc presigned upload URL, thay vì đưa API key cho browser.
## Dependencies and tooling
Tôi chọn C: SDK không có runtime dependency nào, còn mock server được dùng thư viện.
SDK chỉ dùng built-in của Node ≥ 20.6. Partner cài SDK không kéo theo package nào khác, nên không xung đột version và không có rủi ro supply chain. Upload dùng node:http để đếm byte khi stream body, nhờ đó báo được tiến độ upload, việc mà fetch không làm được.
Mock server chỉ là công cụ test, partner không cài nó, nên dùng Fastify + @fastify/multipart (plugin chính thức, nhận file dạng stream). So với Express, Fastify có hooks theo vòng đời request, rất hợp để cài chaos (503 ngẫu nhiên), auth guard và requestId thành các plugin riêng. Ngoài ra app.inject() cho phép test mà không cần mở port. So với NestJS, Fastify nhẹ hơn nhiều, phù hợp với một server chỉ có 6 endpoint
## The SDK should get a fresh token before a stream upload
Tôi giữ thiết kế này. Stream chỉ đọc được một lần nên SDK không thể re-auth rồi gửi lại khi gặp 401: nếu token bị từ chối, stream đã bị tiêu thụ và partner phải mở lại file từ nguồn (vd. S3). Lấy token mới ngay trước khi gửi giảm gần như hết khả năng đó (token hết hạn do lệch đồng hồ, bị thu hồi, đổi secret). Nếu chính lời gọi lấy token thất bại thì stream vẫn chưa bị đọc, partner có thể thử lại an toàn.
Chi phí là thêm một lời gọi auth cho mỗi upload stream. Buffer và file path không bị ảnh hưởng vì chúng retry được, và các upload stream chạy song song dùng chung một lần refresh. Đổi lại, partner có thể pipe file thẳng từ S3 vào SDK mà không cần load toàn bộ vào bộ nhớ.
# Testing
Bộ skill superpower khi execute task implement TDD và chỉ được coi là hoàn thành nếu tất cả các test green. 
Ngoài ra việc review ký các bước brainstorm, plan giúp tôi can thiệp ngay trong quá trình đó để đảm bảo code được generate ra bám sát với đúng ý định ban đầu.
Trước khi commit code tôi chạy skill để review code để không bỏ sót những edge case. Yêu cầu agent giải thích và đưa solution trước để có thể kiểm tra xem issue đó thực sự xảy ra không? và solution ảnh hưởng tới code hiện tại là gì.