// All town / office small talk, by situation. Pure data: sim.ts, traffic.ts and ref-vanphong/adapter.ts pick from here.
// Keep it light: office banter, slang ok, nothing explicit, no slurs. test/dialogue.test.ts asserts >= 30 unique lines each.
export type Pair = readonly [string, string];
export const LINES = {
  /** NPCs chatting nonsense */
  chat: [
    'Hôm nay trời đẹp ghê', 'Ông thấy con cá sấu nhìn tôi không?', 'Deadline là gì, ăn được không?', 'Tối nay đá bóng không?', 'Giá vàng lại lên rồi',
    'Tôi vừa mơ thấy một con bug', 'Mạng lag quá trời', 'Có ai thấy con chó Chos An đâu không?', 'Cuối tuần đi Vũng Tàu nhé', 'Nghe nói sếp sắp tăng lương',
    'Code chạy được thì đừng động vào', 'Trà đá 3 nghìn một cốc thôi', 'Ông có tin người ngoài hành tinh dùng Excel không?', 'Hôm qua tôi ngủ 3 tiếng, tỉnh như sáo',
    'Con mèo Meow nợ tôi một con cá', 'Tôi định bỏ việc đi bán bánh mì', 'Bánh mì có cần CI/CD không nhỉ?', 'Kẹt xe từ nhà đến đây 2 tiếng', 'Tôi mới mua cái bàn phím 3 triệu, gõ vẫn sai chính tả',
    'Hôm nay thứ mấy rồi nhỉ?', 'Ông có biết sao cá sấu không ăn sếp không?', 'Đồn là quán Xuka mới có gói VIP', 'Tôi nuôi một con cây, nó héo vì thiếu meeting',
    'Sáng nay tôi thấy con chó đọc báo', 'Lương về là tiêu, tiêu xong là chờ', 'Hay mình mở quán trà đá cạnh hồ cá sấu?', 'Xe máy tôi đổ xăng còn đắt hơn cà phê',
    'Tôi vừa xem horoscope, hôm nay không nên deploy', 'Có ai thấy chìa khóa xe tôi không?', 'Ông thử nói chuyện với con cá sấu chưa?', 'Mai nghỉ lễ à? Không à? Buồn thế',
    'Tôi nghĩ con chó này thông minh hơn PM', 'Vừa có xe tăng đi qua hay tôi mơ?',
  ],
  /** going for / drinking coffee at Crossian Cafe */
  coffee: [
    'Đi Crossian Cafe làm ly bạc xỉu', 'Cà phê Crossian ngon thật', 'Một bạc xỉu ít đá nha', 'Cho em ly đen đá không đường', 'Ly thứ ba rồi, tim đập như deploy',
    'Không có cà phê thì không có code', 'Cà phê muối ở đây đỉnh của chóp', 'Chị chủ ơi thêm sữa!', 'Uống xong chắc fix được 10 bug', 'Cà phê này đắng như review của sếp',
    'Ngồi đây view đẹp, thấy cả hồ cá sấu', 'Ai bao hôm nay?', 'Wifi quán nhanh hơn wifi công ty', 'Cốt dừa hay bạc xỉu đây...', 'Uống cà phê để tỉnh, tỉnh để uống thêm',
    'Cà phê sữa đá chuẩn Sài Gòn', 'Cho ly to nhất, hôm nay sprint review', 'Thêm shot espresso, chiều có meeting', 'Ngửi mùi cà phê là thấy yêu đời', 'Quán này latte art hình con cá sấu',
    'Em ơi ghi sổ, cuối tháng anh trả', 'Uống xong quên luôn ticket', 'Cà phê trứng ở đây béo ngậy', 'Ngồi cafe làm việc mới gọi là remote', 'Cà phê lạnh như tin nhắn của crush',
    'Cho thêm cái bánh croissant, ủa Crossian', 'Hôm nay uống decaf để đỡ run tay khi merge', 'Ly này cho tôi, ly kia cho con bug', 'Uống một ngụm, quên một deadline',
    'Bạc xỉu là chân ái', 'Cà phê ngon mà giá còn rẻ hơn license IDE',
  ],
  /** trà đá / beer at the sidewalk stall */
  beer: [
    'Làm cốc trà đá', 'Làm vài lon bia không?', 'Dô dô!', 'Một hai ba dô!', 'Trà đá vỉa hè là chân ái', 'Thêm lon nữa', 'Chị ơi thêm đá!', 'Hướng dương đâu rồi?',
    'Ngồi ghế nhựa mới ra chất', 'Trà đá free refill nha', 'Uống trà đá chém gió là nghề của tôi', 'Hôm nay tôi mời, mai ông mời', 'Ghế xanh hay ghế đỏ?', 'Bia hơi mát lạnh',
    'Trăm phần trăm!', 'Không say không về... nhưng mai có standup', 'Nhậu xong ai lái xe?', 'Uống trà đá nghe chuyện thiên hạ', 'Bàn bên kia đang bàn chuyện chứng khoán',
    'Thêm đĩa lạc rang', 'Bia này hợp với bug lắm', 'Ngồi vỉa hè ngắm xe tăng chạy qua', 'Trà đá giải nhiệt, giải cả stress', 'Cụng ly vì prod chưa sập', 'Trà đá 3 nghìn mà vui như 3 triệu',
    'Chị chủ quán biết hết bí mật công ty', 'Uống cốc nữa rồi về fix bug', 'Hôm nay tôi chỉ uống nước lọc... đùa đấy', 'Ai làm rơi lon bia xuống hồ cá sấu thế?', 'Trà đá chanh đỉnh thật',
    'Dô vì release thành công!', 'Một ly cho người, một ly cho server',
  ],
  /** heading to Xuka Mát xa */
  massageGo: [
    'Đi Xuka mát xa cái, lưng đau quá', 'Ngồi code 8 tiếng, cổ cứng như bê tông', 'Ai đi mát xa chân không?', 'Xuka có gói "chữa deadline" đấy', 'Đi bấm huyệt cho tỉnh người',
    'Vai tôi gồng như con server lúc peak', 'Xin phép đi mát xa 30 phút', 'Đi mát xa đầu cho thông não', 'Lưng tôi kêu rắc rắc như bàn phím cơ', 'Thưởng cho bản thân một suất mát xa',
    'Xuka hôm nay có khuyến mãi', 'Mát xa xong mới nghĩ ra thuật toán', 'Đi ngâm chân thảo dược nào', 'Cổ tôi bị lỗi 500 rồi', 'Đi mát xa trước khi review PR',
    'Ai rủ tôi đi mát xa thì tôi đi', 'Bác sĩ bảo tôi cần mát xa và nghỉ lễ', 'Đi mát xa thôi, bug để mai', 'Sếp duyệt rồi, đi mát xa', 'Xuka gần lắm, qua đường là tới',
    'Mát xa cổ vai gáy, combo dân văn phòng', 'Đi thư giãn tí, đầu óc quá tải', 'Mát xa xong code sạch hơn', 'Đi để chị Xuka bẻ khớp cho', 'Lưng tôi cần được refactor',
    'Đi mát xa, tắt Slack', 'Đi mát xa đá nóng nào', 'Tôi đặt lịch 3 giờ rồi', 'Hôm nay tự thưởng sau khi fix prod', 'Mát xa chân thôi, chân đi họp nhiều quá', 'Đi mát xa mắt, nhìn màn hình mờ hết rồi',
  ],
  /** at / talking about the massage */
  massageTalk: [
    'Ui da, đúng chỗ đau!', 'Nhẹ tay thôi chị ơi', 'Cổ vai gáy của tôi bị merge conflict', 'Chỗ này là do ngồi họp đấy', 'Sướng quá, quên luôn deadline', 'Chị bấm huyệt như debug ấy, trúng ngay',
    'Lưng tôi nghe như rang lạc', 'Tôi ngủ quên mất 5 phút', 'Gói 60 phút mà thấy như 6 phút', 'Thêm 15 phút nữa được không chị?', 'Đá nóng ấm quá', 'Tinh dầu sả thơm ghê',
    'Mát xa xong người nhẹ như release patch', 'Vai tôi cứng do gánh team', 'Chị Xuka bảo tôi stress nặng', 'Tôi nên mát xa mỗi sprint', 'Ngâm chân thảo dược đúng là chân ái',
    'Bấm huyệt chân xong muốn đi bộ về nhà', 'Ông thử gói cổ vai gáy chưa? Đỉnh lắm', 'Lần sau rủ cả team đi team building ở đây', 'Mát xa ở đây còn có trà gừng',
    'Chị ấy biết tôi ngồi code tư thế xấu', 'Tôi nghe khớp kêu tách tách như compile', 'Mát xa xong mới thấy đời đáng sống', 'Nằm đây mơ thấy bug tự fix',
    'Tay chị ấy mạnh hơn cả máy xúc ngoài đường', 'Đề xuất công ty cho mát xa vào phúc lợi', 'Mát xa đầu xong nhớ ra password', 'Đừng gọi tôi, tôi đang thư giãn', 'Ra về mà người như mới cài lại Windows',
    'Chị bảo lưng tôi như người 60 tuổi', 'Tuần sau tôi đặt lịch tiếp',
  ],
  /** running outside / jogging around */
  run: [
    'Chạy bộ cho khỏe!', 'Ra ngoài hít thở tí', 'Tránh ra, tôi đang vội!', 'Chạy deadline đây', 'Đi lấy hàng shipper', 'Chạy trốn meeting', 'Ra cổng lấy cơm hộp', 'Chạy cho kịp xe buýt',
    'Đi dạo một vòng quanh hồ', 'Tập thể dục, sếp bảo thế', 'Chạy 5 km rồi đấy... trong mơ', 'Đi tìm con chó Chos An', 'Ai thấy cái ô của tôi không?', 'Đi rút tiền ATM', 'Ra ngoài nghe điện thoại',
    'Đi mua bánh mì', 'Đi đón con Meow về', 'Ra xem tai nạn ngoài đường', 'Chạy đi nộp hồ sơ', 'Đi gửi xe', 'Đi ngắm xe tăng', 'Chạy thể dục buổi trưa', 'Ra hóng gió tí',
    'Đi mua vé số', 'Chạy cho tiêu bớt cà phê', 'Ra ngoài tìm sóng 4G', 'Chạy vì nghe nói prod sập', 'Đi bộ 10 nghìn bước', 'Chạy kẻo trời mưa', 'Đi lấy laptop sửa', 'Tôi bị shipper gọi xuống',
  ],
  /** slipping into the croc pond on their own */
  slipPond: [
    'Ơ ơ ơ trượt chân!', 'Ai đổ dầu ở đây thế?!', 'Tôi chỉ muốn chụp ảnh con cá sấu thôi mà!', 'Rêu trơn quá!', 'Không không không!', 'Ơ kìa, bờ hồ đâu rồi?', 'Úi giời ơi!',
    'Tôi bơi dở lắm!', 'Đừng có nhìn tôi như bữa trưa!', 'Biển cấm cho ăn đâu nói cấm tự nhảy!', 'Chết rồi điện thoại!', 'Tôi vấp phải con bug!', 'Ơ sao nước lạnh thế!', 'Ai đẩy tôi đấy?!',
    'Lẽ ra tôi phải đọc biển báo', 'Cá sấu ơi tôi ít thịt lắm!', 'Mẹ ơi!', 'Tôi chỉ đi tắt thôi mà', 'Mải nhìn điện thoại quá!', 'Tôi tưởng đây là bể bơi!', 'Ướt hết laptop rồi!',
    'Cái lá sen lừa tôi!', 'Không phải hôm nay chứ!', 'Tôi đang đọc tin nhắn sếp mà!', 'Bờ hồ thiếu lan can!', 'Ai ném vỏ chuối ở đây?!', 'Tôi chưa commit code!', 'Á á á lạnh quá!', 'Cá sấu ơi bình tĩnh!',
    'Tôi chỉ muốn ngắm hoa sen', 'Trượt như con trỏ chuột hết pin',
  ],
  /** being thrown to the crocodiles */
  thrown: [
    'Áaaaa!', 'Tôi làm gì sai?!', 'Không phải tôi push lên main!', 'Tôi sẽ viết test mà!', 'Đừng ném tôi, tôi biết lỗi rồi!', 'Bay như con chim!', 'Tôi chưa nhận lương tháng này!',
    'Tôi sẽ không deploy thứ Sáu nữa!', 'Cái này có trong hợp đồng không?!', 'Tôi báo HR đấy!', 'Ai bấm nút ném vậy?!', 'Cho tôi viết nốt dòng code!', 'Tôi chỉ quên một dấu chấm phẩy thôi!',
    'Bay xa thế này là kỷ lục!', 'Tôi sẽ review PR nhanh hơn!', 'Cá sấu ơi tôi không ngon đâu!', 'Ném nhẹ tay thôi!', 'Tôi xin lỗi vì cái bug hôm qua!', 'Chuyện này sẽ được ghi vào retro!',
    'Tôi sẽ quay lại! Sau 20 giây!', 'Đây là quấy rối nơi công sở!', 'Tôi chưa push code!', 'Ít nhất cho tôi cái phao!', 'Tôi sẽ không bao giờ comment code nữa... ý là sẽ!', 'Cái này là feature hay bug?!',
    'Tôi bay qua cả con đường!', 'Chuyến bay không có trong sprint!', 'Hạ cánh an toàn nhé!', 'Tôi xin nghỉ phép thay vì bị ném!', 'Ai đấy?! Tôi nhớ mặt rồi!', 'Bố mẹ ơi con bay!',
  ],
  /** inside the croc */
  eaten: [
    'Cứu với!!!', 'Trong này tối quá!', 'Cá sấu ơi nhả tôi ra!', 'Tôi chỉ là con dev nhỏ bé!', 'Ai gọi bảo vệ đi!', 'Ơ nó nhai thật à?!', 'Tôi sẽ quay lại!', 'Cá sấu đánh răng chưa vậy?!',
    'Ui, cái răng!', 'Cho tôi ra, tôi có standup!', 'Tôi không có trong thực đơn!', 'Nhả ra, tôi khó tiêu lắm!', 'Đừng nuốt laptop!', 'Ở đây có wifi không?', 'Báo sếp tôi đi muộn!',
    'Cá sấu ơi tôi toàn xương!', 'Mùi trong này kinh quá!', 'Tôi đã nói rồi, đừng cho ăn!', 'Tôi thấy ánh sáng cuối đường hầm!', 'Kéo tôi lên với!', 'Ai quay video đấy?!',
    'Gọi xe cứu thương!', 'Tôi sẽ viết post-mortem về vụ này!', 'Á, nó lắc tôi!', 'Tôi sẽ khiếu nại!', 'Cá sấu ăn chay đi!', 'Ơ có thằng nào ở trong này nữa à?', 'Cho tôi gửi lời chào gia đình!',
    'Tôi chỉ muốn đi uống trà đá thôi!', 'Lần sau tôi đi đường vòng!', 'Nó cắn trúng cái ví tôi!',
  ],
  /** coming back after the pond */
  back: [
    'Tôi đã trở lại!', 'Sống sót rồi!', 'Cá sấu nhả tôi ra vì tôi khó ăn', 'Ướt hết rồi nhưng vẫn đẹp trai', 'Ai ném tôi thì liệu hồn!', 'Một ngày đẹp trời để sống tiếp',
    'Tôi về rồi, có ai nhớ tôi không?', 'Không sao, chỉ trầy xước tí', 'Lần sau nhớ mặc áo phao', 'Trong bụng cá sấu có wifi đấy', 'Tôi vừa có trải nghiệm tâm linh', 'Respawn thành công!',
    'Như được tái sinh', 'Tôi sẽ không bao giờ lại gần hồ nữa... chắc thế', 'Ai pha cho tôi cốc trà nóng?', 'Cá sấu bảo tôi gửi lời chào', 'Đời vẫn đẹp sao!', 'Tôi vừa từ cõi chết trở về',
    'Quần áo tôi mùi cá sấu', 'Vẫn kịp standup!', 'Cần đi mát xa gấp', 'Ai nhặt hộ tôi cái dép?', 'Cảm ơn cá sấu đã tha mạng', 'Tôi sẽ viết blog về chuyện này', 'Mạng thứ hai đây!',
    'Ai bảo tôi chết? Tôi bất tử!', 'Sếp ơi em về rồi, em làm tiếp', 'Đi qua cửa tử rồi, giờ sợ gì deadline', 'Kinh nghiệm: cá sấu không thích code PHP', 'Tôi là bug, không xóa được đâu', 'Về nhà thay đồ đã',
  ],
  /** Chos An barking */
  dogBark: [
    'GÂU GÂU GÂU GÂU!!!', 'GÂU! GÂU!', 'Grừ... GÂU!', 'Ẳng ẳng!', 'GÂUUUUU!', 'Gâu gâu (có người lạ!)', 'Gâu gâu (đồ ăn đâu?)', 'GÂU! (xe tăng kìa!)', 'Gâu gâu gâu (con mèo kìa!)',
    'Ư ử... GÂU!', 'Gâu! (sủa cho vui)', 'GÂU GÂU (shipper đến!)', 'Ẳng! (ai dẫm đuôi tao)', 'Gâu gâu gâu gâu gâu gâu', 'GÂUUU (tao là boss khu này)', 'Gâu (chào buổi sáng)', 'Grrr GÂU (xe máy!)',
    'Gâu gâu (cá sấu nhìn tao)', 'GÂU! (đèn đỏ rồi kìa)', 'Gâu gâu (đi dạo đi)', 'Ẳng ẳng ẳng!', 'GÂU (prod sập à?)', 'Gâu gâu (cho xin miếng bánh mì)', 'GRRRR GÂU GÂU!', 'Gâu! Gâu! Gâu!',
    'Gâu (tao nghe tiếng xe cứu hỏa)', 'GÂU (thằng kia đi ngang)', 'Gâu gâu (Meow lại đến)', 'Hú húuuuu! Gâu!', 'Gâu gâu (vui quá!)', 'GÂU (có mùi cà phê)',
  ],
  /** people reacting to the barking */
  dogReact: [
    'Chos An im lặng nào!', 'Con chó này sủa to hơn chuông báo động', 'Nó sủa gì thế nhỉ?', 'Chắc nó đói', 'Chos An ngoan, cho bánh nè', 'Ai dắt chó đi dạo đi', 'Nó sủa cả xe tăng luôn kìa',
    'Đừng sủa nữa, tao đang call!', 'Chos An là bảo vệ giỏi nhất công ty', 'Nó sủa đúng lúc demo cho khách', 'Con chó biết có bug à?', 'Thôi nào Chos An', 'Tiếng sủa như alert Prometheus',
    'Chos An lại thấy con mèo rồi', 'Nó sủa người giao hàng', 'Chó nhà ai mà dễ thương thế', 'Chos An sủa cả cá sấu', 'Nó sủa như PM hỏi tiến độ', 'Bình tĩnh đi con', 'Có ai mang xương không?',
    'Ồn quá, không nghe được meeting', 'Chắc nó muốn đi mát xa', 'Nó sủa vì thấy tôi đẹp trai', 'Ngoan nào, ngồi xuống', 'Chos An có lương không nhỉ?', 'Sủa tiếp đi, tôi đang buồn ngủ',
    'Nó sủa cái xe lu kìa', 'Chos An cho tao yên!', 'Ai thả chó ra đấy?', 'Nó canh cửa còn hơn bảo vệ', 'Con chó này nên làm IT Ops',
  ],
  /** Meow starting the fight */
  catFight: [
    'Meoooo! Xì!', 'Meo! Tránh ra con chó!', 'Xììì! Lãnh thổ của tao!', 'Meo meo (đánh nhau không?)', 'Meooo! Trả cá đây!', 'Xì xì xì!', 'Meo! (tao là boss)', 'Meooooo!!!',
    'Meo (chó gì mà xấu)', 'Xì! Ai cho mày ngồi chỗ tao?', 'Meo meo meo! (tát cho phát)', 'Grừ meo!', 'Meo! (đuôi mày vướng)', 'Xì! (hôm nay tao cáu)', 'Meo (nhìn gì?)', 'Meoooo (lại đây!)',
    'Xì xì (mày sủa to quá)', 'Meo! (cá khô đâu?)', 'Meo meo (tao 9 mạng)', 'Xìììì!!!', 'Meo (đấu tay đôi)', 'Meo! (ai là trùm?)', 'Meo meo (mày ăn vụng)', 'Xì! (đừng có lại gần)',
    'Meo (mèo hơn chó)', 'Meooo (hôm qua mày cắn dép tao)', 'Xì! (đừng sủa nữa)', 'Meo meo meo meo!', 'Meo (tao có móng)', 'Xì (tránh xa ghế sofa)', 'Meo! (tao đến đây)',
  ],
  /** Chos An fighting back */
  dogFight: [
    'GÂU! GRRRR!', 'Gâu! (mèo hư!)', 'GRRR! (đến đây)', 'Gâu gâu! (tao không sợ)', 'Ẳng! Nó cào tao!', 'GÂU! (trả dép đây)', 'Grừ! (lãnh thổ của tao)', 'GÂU GÂU (đánh thì đánh)',
    'Ẳng ẳng (đau quá)', 'GRRR GÂU (tao cắn đấy)', 'Gâu! (mèo gì mà dữ)', 'GÂU (cứu tôi với)', 'Gâu gâu (mày chơi xấu)', 'Ẳng! (móng mày sắc thế)', 'GRRRRR!', 'Gâu! (hòa nhé?)',
    'GÂU! (tao báo chủ đấy)', 'Gâu gâu (đuổi theo!)', 'Grừ (lần này tao thắng)', 'Ẳng (thôi tao chạy)', 'GÂU GÂU GÂU!', 'Gâu (mèo không được lên bàn)', 'Grrr (cá khô là của tao)',
    'GÂU (mày 9 mạng thì sao)', 'Gâu! (đừng cào mặt)', 'GÂU (mèo hư mèo hư)', 'Ẳng ẳng (sao mày nhanh thế)', 'Gâu gâu (tao gọi bạn đến)', 'GRRR (nhìn cái gì)', 'Gâu! (về nhà đi)', 'GÂU (đây là sân của tao)',
  ],
  /** IT Ops alert openers (spoken at the indoor desk) */
  itopsGo: [
    'Có biến! Phải báo cáo!', 'Đỏ lòm dashboard rồi!', 'Alert kêu như còi xe cứu hỏa!', 'Chạy đi báo sếp!', 'Prometheus gào thét rồi!', 'Toang rồi, báo gấp!', 'Ai đó gọi on-call!',
    'Biểu đồ dựng đứng!', 'P99 bay lên trời rồi!', 'Có cháy! Ý là cháy server!', 'Tránh đường, tôi đi báo sự cố!', 'Không phải tôi làm đâu!', 'CPU 100% rồi!', 'Error rate tăng vọt!',
    'Mau mau, khách đang kêu!', 'Pager kêu inh ỏi!', 'Đèn đỏ nhấp nháy!', 'Báo động cấp 1!', 'Lại là cái service đó!', 'Đĩa đầy rồi!', 'Memory leak!', 'Latency như rùa bò!',
    'Monitor không nói dối đâu!', 'Sếp ơi chờ em!', 'Incident mới nóng hổi!', 'Ai deploy lúc nãy thế?!', 'Healthcheck fail liên tục!', 'Đồ thị như tàu lượn!', 'Có sự cố, có sự cố!', 'Gọi on-call ngay!',
    'Prod đang khóc!',
  ],
  /** IT Ops report prefix (followed by the alert name) */
  itopsReport: [
    'Sếp ơi!', 'Báo cáo sếp!', 'Anh ơi, có biến:', 'Khẩn cấp:', 'Sếp ơi toang rồi:', 'Anh xem giúp em:', 'Cảnh báo đỏ:', 'Sếp ơi prod kêu cứu:', 'Em vừa thấy:', 'Dashboard báo:',
    'Sếp, monitor đang hú:', 'Báo động:', 'Anh ơi cháy nhà rồi:', 'Sự cố mới:', 'Alert nóng hổi:', 'Có chuyện rồi anh:', 'Prometheus bảo:', 'Anh ơi, lại nữa:', 'Sếp ơi đừng giận:',
    'Mất ngủ rồi anh ơi:', 'Thông báo khẩn:', 'Em thề không phải em:', 'Pager vừa gọi:', 'Sếp nhìn này:', 'Đỏ hết rồi:', 'Anh ơi, khách đang chửi:', 'On-call ơi:', 'Báo cáo tình hình:',
    'Sếp ơi bình tĩnh nghe em nói:', 'Anh ơi đừng hoảng:', 'Incident cấp cao:',
  ],
  /** pedestrian knocked over by a vehicle */
  hit: [
    'Á! Đi đứng kiểu gì thế?!', 'Ui da, cái mông tôi!', 'Tôi đang đi trên vạch kẻ đường mà!', 'Ơ kìa, xe không phanh à?!', 'Bay cả dép rồi!', 'Không sao, tôi cứng lắm', 'Ai trả tiền viện phí?!',
    'Lái xe hay lái máy bay vậy?!', 'Tôi vẫn sống!', 'Đâm người rồi chạy à?!', 'Cái kính của tôi!', 'Trời ơi, cái bánh mì!', 'Tôi chỉ qua đường mua trà đá thôi!', 'Đèn đỏ mà!',
    'Ối giời ơi!', 'Tôi sẽ đứng dậy mạnh mẽ hơn!', 'Bảo hiểm có chi trả không?', 'Đi chậm thôi!', 'Ngã một cái tỉnh cả người', 'May mà tôi mặc áo khoác dày', 'Lại phải đi mát xa rồi',
    'Xe này chạy bằng gì mà nhanh thế?!', 'Tôi không thấy xe!', 'Đâm vào tôi thì xin lỗi đi chứ!', 'Hôm nay xui thật!', 'Tôi chỉ nhìn điện thoại một tí!', 'Có ai quay lại không?', 'Đường này nguy hiểm quá',
    'Tôi bị đâm lần thứ ba trong tuần!', 'Nằm đây nghỉ tí đã', 'Gọi xe cứu thương... à thôi không cần',
  ],
  /** driver after hitting someone */
  hitDriver: [
    'Xin lỗi xin lỗi!', 'Ai bảo đi ra giữa đường!', 'Phanh không ăn!', 'Anh có sao không?', 'Tôi bấm còi rồi mà!', 'Đường của xe chứ của người à?!', 'Xin lỗi, tôi đang xem bản đồ',
    'Anh chạy ra bất ngờ quá!', 'Để tôi đền cái bánh mì', 'Tôi đi đúng làn mà!', 'Ơ tôi tưởng là cái cột!', 'Anh đứng dậy được không?', 'Xe mới mua, chưa quen', 'Lỗi tại con chó!',
    'Tôi chỉ chạy 30 thôi!', 'Gọi bảo hiểm đi!', 'Không phải lỗi tôi!', 'Thôi đi tiếp đây!', 'Anh ơi cẩn thận chứ!', 'Tôi đang giao hàng gấp!', 'Ơ sao không đi trên vỉa hè?',
    'Tôi sẽ đi chậm hơn... mai', 'Ai đặt người giữa đường thế?', 'Đường trơn quá!', 'Tôi lái xe 20 năm chưa đâm ai... đến hôm nay', 'Xin lỗi, tôi đang nghe podcast', 'Anh nhìn đường đi chứ!',
    'Đâm nhẹ thôi mà!', 'Xe tôi có sao không?!', 'Thôi bắt tay làm hòa', 'Mai tôi đi xe buýt',
  ],
  /** honking when stuck behind a crash */
  honk: [
    'Bíp bíp!', 'Tránh đường!', 'Đi đi chứ!', 'Bíp bíppppp!', 'Kẹt xe rồi!', 'Sao đứng im thế?!', 'Muộn giờ làm rồi!', 'Dọn đường đi!', 'Cãi gì mà lâu thế?!', 'Bíp! Bíp! Bíp!',
    'Tôi còn đi giao hàng!', 'Nhanh lên mấy ông ơi!', 'Có ai gọi cảnh sát chưa?', 'Tắc đường như hàng đợi Kafka', 'Bíppp, đi thôi!', 'Ai đậu xe giữa đường thế?!', 'Đường này lúc nào cũng kẹt',
    'Cho qua với!', 'Tôi đi họp muộn mất!', 'Bíp bíp bíp bíp!', 'Kẹt hơn deploy pipeline', 'Mở đường cho xe cứu thương!', 'Đi tiếp đi mà!', 'Bíp! Tôi là xe tăng đây!', 'Còi kêu như alert',
    'Vòng lại đi!', 'Không ai đi à?!', 'Bíp bíp, nóng quá!', 'Chở hàng tươi đấy!', 'Còi xe hết pin rồi', 'Tránh ra cho máy xúc làm việc!',
  ],
  /** someone sees a fire */
  fire: [
    'Cháy! Cháy rồi!', 'Gọi 114!', 'Xe bốc khói kìa!', 'Ai có bình chữa cháy không?', 'Chạy đi, sắp nổ!', 'Tránh xa ra!', 'Lửa to quá!', 'Mùi khét quá!', 'Gọi xe cứu hỏa!',
    'Đừng quay video nữa, chạy đi!', 'Ơ xe tôi!', 'Có ai trong xe không?', 'Khói đen mù mịt!', 'Cháy như server mùa sale!', 'Trời ơi cái xe!', 'Đứng xa xa ra!', 'Ai hút thuốc gần cây xăng thế?!',
    'Bảo hiểm có đền không?!', 'Nóng quá!', 'Lửa lan sang làn bên kia!', 'Ra khỏi xe ngay!', 'Mang nước ra!', 'Trà đá dập lửa được không?', 'Cứu hỏa đang tới!', 'Ai gọi cứu hỏa chưa?!',
    'Khói bay vào văn phòng rồi!', 'Cháy xe giữa trưa!', 'Tôi đã nói xe này hay nóng máy mà!', 'Lùi lại, lùi lại!', 'Cảnh sát ơi!', 'Cháy to như incident cấp 1!',
  ],
  /** after an explosion */
  boom: [
    'BÙMMM!', 'Ối trời ơi nổ rồi!', 'Tai tôi ù hết!', 'Kính văn phòng rung luôn!', 'Nổ như pháo Tết!', 'Ai bật nhạc to thế? À không, nổ xe', 'Bay cả nón bảo hiểm!', 'Mọi người có sao không?',
    'Giờ chỉ còn cái khung!', 'May mà không ai ở trong!', 'Kinh khủng thật!', 'Nổ to hơn prod sập!', 'Cá sấu cũng giật mình!', 'Chos An chạy mất rồi!', 'Đồ thị CPU cũng không dựng đứng thế!',
    'Tôi đánh rơi cốc cà phê!', 'Nổ xong khói bay mù mịt', 'Ai chụp ảnh được không?', 'Bùm một phát là xong', 'Hết hồn!', 'Xe thành đống sắt vụn!', 'Gọi dọn đường!', 'Trời ơi tim tôi!',
    'Như phim hành động!', 'Văn phòng mất điện chưa?', 'Nổ thế này ai đền?', 'Kinh nghiệm: đừng đỗ xe cạnh xe tăng', 'Nghe tiếng nổ mà tưởng deadline', 'Xong, giờ đi bộ', 'Đường bị chặn rồi', 'Mai lên báo cho xem',
  ],
  /** fire crew arriving */
  fireCrew: [
    'Cứu hỏa đây, tránh ra!', 'Phun nước!', 'Mọi người lùi lại!', 'Dập lửa ngay!', 'Có ai bị thương không?', 'Kéo vòi vào đây!', 'Lửa sắp tắt rồi!', 'Đừng đứng xem nữa!',
    'Xe này cháy lần thứ mấy rồi?', 'Kiểm tra bình xăng!', 'An toàn rồi!', 'Ai gọi 114?', 'Chúng tôi đến kịp lúc!', 'Phun bọt chữa cháy!', 'Tắt máy xe đi!', 'Khu vực nguy hiểm!',
    'Đội cứu hỏa có mặt!', 'Tránh đường cho xe cứu hỏa!', 'Nước đây!', 'Lửa đã được khống chế!', 'Cảm ơn mọi người đã bình tĩnh', 'Đã báo bảo hiểm chưa?', 'Dọn hiện trường thôi!',
    'Hôm nay ca này bận quá', 'Đây là vụ thứ năm hôm nay', 'Ai có trà đá cho anh em không?', 'Đừng ném nước đá vào lửa!', 'Cẩn thận nổ lần nữa!', 'Lùi xa 50 mét!', 'Xong rồi, an toàn!', 'Chúc mọi người buổi chiều an lành',
  ],
  /** police arriving at a crash */
  police: [
    'Cảnh sát đây! Ai gây tai nạn?', 'Xuất trình giấy tờ!', 'Hai anh bình tĩnh!', 'Đừng cãi nữa, lập biên bản!', 'Thổi vào đây!', 'Ai vượt đèn đỏ?', 'Dời xe vào lề!', 'Có camera ghi lại hết!',
    'Bằng lái đâu?', 'Xe này đăng kiểm chưa?', 'Ai làm chứng?', 'Giải tán, đừng đứng xem!', 'Làm việc ở đồn nhé!', 'Hai anh tự thỏa thuận hay lên phường?', 'Phạt cả hai!', 'Đường này cấm xe tăng!',
    'Ai cho máy xúc chạy giờ này?', 'Mời anh xuống xe!', 'Đã uống bia chưa?', 'Bình tĩnh, không ai bị sao là tốt rồi', 'Kéo xe đi!', 'Ghi lại biển số!', 'Lần sau đi chậm thôi!', 'Hôm nay tôi trực mệt quá',
    'Ai gọi cảnh sát?', 'Lập biên bản hiện trường!', 'Đừng quay phim cảnh sát!', 'Hai anh bắt tay làm hòa đi', 'Xe cẩu đến kéo xe!', 'Thông đường ngay!', 'Mỗi người nói một câu thôi!',
  ],
  /** agents thinking (no tool text yet) */
  thinking: [
    'Hmm...', 'Để tôi nghĩ đã', 'Cái này hơi khó', 'Đọc lại yêu cầu lần nữa', 'Có cách nào đơn giản hơn không?', 'Nghĩ mãi không ra', 'Chờ tí, sắp nghĩ ra rồi', 'Cái bug này từ đâu ra?',
    'Liệu có edge case nào không...', 'Hình như tôi đã thấy cái này ở đâu', 'Đang load não...', 'Để tôi google... à không, tự nghĩ', 'Có nên refactor không ta?', 'Chắc là do cache', 'Đọc code người khác đau đầu thật',
    'Thuật toán nào đây...', 'Logic này lạ quá', 'Tại sao nó lại chạy được?!', 'Tại sao nó lại không chạy?!', 'Có phải lỗi timezone không?', 'Uống cà phê xong mới nghĩ được', 'Đang suy nghĩ như Opus',
    'Vẽ sơ đồ trong đầu', 'Cái này cần design doc', 'Không biết sếp muốn gì', 'Nghĩ xong rồi quên mất', 'Chờ inspiration', 'Có khi phải hỏi Architect', 'Off-by-one ở đâu đây?', 'Để tôi đọc lại spec', 'Chắc phải viết test trước',
  ],
  /** agents working (no tool text yet) */
  working: [
    'Đang code, đừng làm phiền', 'Gõ phím như bão', 'Chạy test cái đã', 'Sắp xong rồi... chắc thế', 'Commit nhỏ, commit thường xuyên', 'Đang fix bug', 'Build lại lần thứ 7', 'Đang viết test',
    'Ctrl+S liên tục', 'Đang refactor cho đẹp', 'Đang đọc log', 'Đợi CI chạy', 'Thêm console.log cho chắc', 'Đang cài package', 'npm install mãi không xong', 'Đang tối ưu performance',
    'Viết nốt cái function này', 'Đang sửa typo', 'Đang đặt tên biến... khó nhất', 'Đang chạy migration', 'Gõ code nghe nhạc lofi', 'Đang tạo PR', 'Đang rebase', 'Đang đọc docs',
    'Đang hỏi Stack Overflow', 'Đang viết comment', 'Đang xóa code chết', 'Làm việc chăm chỉ như con ong', 'Đang debug step by step', 'Đang deploy lên staging', 'Đang dọn warning',
  ],
  /** agents done (no result text) */
  done: [
    'Xong!', 'Done, đi uống trà đá thôi', 'Test xanh hết rồi!', 'PR đã sẵn sàng review', 'Hoàn thành trước deadline!', 'Xong việc, ai cần giúp không?', 'Deploy thành công!', 'Ticket closed!',
    'Làm xong rồi, thưởng ly bạc xỉu', 'Hết bug rồi... tạm thời', 'Ngon lành cành đào', 'Xong sớm, đi mát xa', 'Merge rồi nhé!', 'Chạy ngon trên máy tôi', 'Đã xong, chờ feedback', 'Code sạch bong',
    'Hoàn thành nhiệm vụ!', 'Ổn rồi sếp ơi', 'Xong cái này, nghỉ tí', 'Đẹp như mơ', 'Release note viết xong', 'Hết việc rồi, làm gì tiếp?', 'Xong, đi ăn trưa', 'Không còn warning nào', 'Đã fix xong',
    'Mọi thứ đều xanh', 'Xong việc, ngồi chơi game', 'Đã ship!', 'Tôi là thiên tài', 'Không ngờ chạy luôn', 'Xong việc trước giờ tan làm',
  ],
  /** agents in error (no error text) */
  error: [
    'Toang rồi!', 'Lỗi rồi!', 'Cái gì thế này?!', 'Build fail!', 'Test đỏ lòm!', 'Ai đổi API thế?!', 'Null pointer!', 'Timeout rồi', 'Không connect được database', 'Hết quota rồi',
    'Segfault!', 'Lỗi 500!', 'Permission denied!', 'Out of memory!', 'Merge conflict!', 'Lỗi không rõ nguyên nhân', 'Nó chạy trên máy tôi mà!', 'Undefined is not a function', 'Module not found!',
    'Mạng chập chờn', 'CI chết rồi', 'Lỗi typo ngớ ngẩn', 'Lại là timezone!', 'Port bị chiếm', 'Disk full!', 'Rate limited!', 'Ai xóa file này?!', 'Không hiểu sao lỗi', 'Stack trace dài như sớ', 'SSL hết hạn!', 'Tôi cần trợ giúp!',
  ],
  /** agents chatting in the office (pairs take turns) */
  agentChat: [
    'Trưa nay ăn gì?', 'Bug này lạ thật', 'Test xanh hết rồi', 'Review giúp tao cái PR', 'Ai merge vào stable thế?', 'Deploy thứ Sáu à?', 'Opus nghĩ lâu quá', 'Haiku nhanh ghê', 'Cuối tuần đi đâu?',
    'Ticket này ai nhận?', 'Cà phê không?', 'Prod vẫn ổn chứ?', 'Chiều đi mát xa Xuka không?', 'Xuka mới có gói cổ vai gáy', 'Ngoài đường lại đâm xe kìa', 'Thấy xe tăng đi qua chưa?', 'Sprint này dài thế',
    'Standup hôm nay ngắn nhé', 'Ai viết cái regex này?', 'Đổi sang Rust không?', 'Copilot hôm nay ngáo quá', 'Có ai biết Kubernetes không?', 'Retro hôm nay nói gì?', 'Ai ăn bánh trong tủ lạnh?',
    'Trà đá vỉa hè chiều nay nhé', 'Con cá sấu lại ăn ai rồi', 'Lương tháng này về chưa?', 'Tao vừa đặt lịch mát xa chân', 'Mát xa xong code mượt hẳn', 'Có nên viết lại từ đầu không?', 'Monitor lại đỏ kìa',
  ],
  /** agents at the coffee machine */
  agentCoffee: [
    'Thêm đá nha', 'Máy hết sữa rồi', 'Ly thứ ba rồi đấy', 'Ai làm hỏng máy pha cà phê?', 'Cà phê văn phòng dở hơn Crossian', 'Pha đặc vào', 'Hết đường rồi', 'Ai uống ly của tao?',
    'Cà phê này để chạy deadline', 'Máy kêu như CI chạy', 'Ly này cho cái bug', 'Uống xong code tiếp', 'Một espresso double', 'Rửa ly đi ông ơi', 'Cà phê hòa tan cũng được', 'Mai mang trà sữa',
    'Cà phê giúp tôi sống sót', 'Đừng uống nhiều, tối mất ngủ', 'Đi Crossian ngon hơn', 'Ai mua thêm cà phê hạt?', 'Máy báo hết nước', 'Thêm sữa đặc', 'Uống cà phê ngắm cá sấu', 'Cà phê nguội rồi',
    'Pha cho tao một ly', 'Hôm nay uống trà thôi', 'Cà phê không đường như cuộc đời', 'Ai đổ cà phê ra bàn?', 'Lại cạn ly', 'Cà phê tiếp năng lượng', 'Tách cà phê thứ 5',
  ],
  /** agents at the pool table */
  agentPool: [
    'Bi số 8!', 'Trượt rồi...', 'Xem tao đánh nè', 'Ăn cơ!', 'Lỗi đánh rồi!', 'Bi vào lỗ như PR được merge', 'Ai thua mua trà đá', 'Cơ này cong à?', 'Đánh nhẹ thôi', 'Tính góc như hình học',
    'Ván nữa không?', 'Tao là cao thủ', 'Ăn may thôi', 'Bi trắng vào lỗ rồi!', 'Đánh như code: thử và sai', 'Đánh băng ba băng!', 'Chơi bida để tránh meeting', 'Cẩn thận vỡ đèn',
    'Bi đỏ đâu rồi?', 'Ông đánh kém quá', 'Tôi tập bida trên YouTube', 'Thêm phấn vào cơ', 'Lượt tôi!', 'Cú này đẹp không?', 'Bàn nghiêng à?', 'Cá cược một ly bạc xỉu', 'Ván cuối rồi đi làm',
    'Ai thắng được ngồi gần cửa sổ', 'Bi vào liên tục!', 'Trượt như deadline', 'Đánh hay quá trời',
  ],
};
/** Two-sided exchanges: [first speaker, reply]. */
export const PAIRS = {
  /** arguments about work: code review, deadline, bug blame, merge conflict, prod down, ... */
  workArgue: [
    ['Ai force push lên main thế?!', 'Tao rebase cho sạch thôi mà!'],
    ['Code mày không có test!', 'Test để làm gì khi code tao không bao giờ sai!'],
    ['Tab hay space?!', 'Space! Tab là dành cho người tối cổ!'],
    ['PR của mày 3000 dòng ai review nổi?!', 'Thì chia nhỏ ra mà đọc!'],
    ['Deadline thứ Sáu mà giờ mới làm?!', 'Estimate là của PM chứ có phải của tao đâu!'],
    ['Bug này do mày!', 'Git blame đi, tên mày to đùng kìa!'],
    ['Ai đặt tên biến là x2_final_v3?!', 'Đặt tên là việc khó nhất trong ngành!'],
    ['Merge conflict tại mày sửa file của tao!', 'File của công ty chứ của mày à?!'],
    ['Prod sập rồi! Ai deploy?!', 'Pipeline xanh mà, tại infra!'],
    ['Infra không có lỗi, lỗi ở code!', 'Code chạy ngon trên máy tao!'],
    ['Thế mang máy mày lên prod đi!', 'Ừ, để tao gói Docker luôn!'],
    ['Comment review của mày toàn "nit:"!', 'Thì code mày toàn nit!'],
    ['Sao lại approve PR khi chưa đọc?!', 'Tao tin mày mà, sai lầm của tao!'],
    ['Mày xóa migration của tao!', 'Nó trùng tên, tao tưởng là rác!'],
    ['Ai hardcode password vào đây?!', 'Tạm thời thôi, tao định sửa từ năm ngoái!'],
    ['Sao mày dùng thư viện 2MB chỉ để pad string?!', 'Không phát minh lại bánh xe!'],
    ['Story này 3 điểm hay 13 điểm?!', 'Fibonacci thì 8 cho cả hai đứa vừa lòng!'],
    ['Mày lại bỏ qua linter!', 'Linter sai chứ tao không sai!'],
    ['Standup mà nói 20 phút?!', 'Tao đang cập nhật quan trọng mà!'],
    ['Ai bật debug log trên prod?!', 'Để bắt bug mà, giờ đĩa đầy thì xóa!'],
    ['Thiết kế này không scale!', 'Có 10 user thì scale làm gì!'],
    ['Microservice gì mà 40 cái?!', 'Mỗi cái một trách nhiệm, chuẩn sách!'],
    ['Viết lại bằng Rust đi!', 'Viết lại thì ai maintain bản cũ?!'],
    ['Sao không update ticket?!', 'Tao code chứ có phải làm Jira đâu!'],
    ['Mày merge mà không squash!', 'History thật mới là history đẹp!'],
    ['Test flaky là tại mày!', 'Test flaky là tại thời tiết!'],
    ['Ai đổi API không báo?!', 'Tao có ghi trong changelog mà!'],
    ['Changelog ai đọc?!', 'Thế thì đọc đi!'],
    ['Code này ai viết, kinh khủng!', '...Mày viết đấy, 2 năm trước!'],
    ['Hotfix mà không review à?!', 'Cháy nhà còn chờ đơn xin phép à?!'],
    ['Mày estimate 1 ngày, giờ là tuần thứ 3!', 'Tao nói 1 ngày làm việc tập trung, chưa có ngày nào tập trung!'],
    ['Lại một cái TODO từ 2019!', 'TODO là lời hứa, chưa đến hạn!'],
    ['Sao deploy lúc 5 giờ chiều thứ Sáu?!', 'Để cuối tuần có việc làm!'],
    ['Database index đâu?!', 'Thêm index thì chậm insert!'],
    ['Mày commit node_modules lên repo!', 'Cho chắc, phòng npm sập!'],
    ['Ai tắt alert đi thế?!', 'Nó kêu nhiều quá, tao ngủ không được!'],
  ],
  /** drivers after two vehicles crash */
  crashArgue: [
    ['Đi kiểu gì thế hả?!', 'Mày phanh gấp chứ ai!'],
    ['Xe tao mới mua!', 'Xe tao cũng mới rửa!'],
    ['Mày vượt ẩu!', 'Tao đi đúng làn, mày lấn làn!'],
    ['Có biết lái xe không?!', 'Tao có bằng từ hồi mày còn đi xe đạp!'],
    ['Đền tiền đây!', 'Mày đền tao thì có!'],
    ['Đèn vàng mà mày cũng lao!', 'Đèn vàng là đi nhanh lên!'],
    ['Mày nhìn điện thoại!', 'Tao xem Google Maps!'],
    ['Gọi cảnh sát!', 'Gọi đi, tao có camera hành trình!'],
    ['Xe tăng thì được đâm à?!', 'Xe tăng có quyền ưu tiên!'],
    ['Máy xúc ai cho ra đường?!', 'Tao đang thi công, mày mù à?!'],
    ['Mày say à?!', 'Tao uống trà đá thôi!'],
    ['Mày bấm còi làm tao giật mình!', 'Còi là để bấm!'],
    ['Biển số mày bao nhiêu?!', 'Biển số đẹp, mày ghen à?!'],
    ['Xe buýt mà đi như xe đua!', 'Xe buýt cũng cần đúng giờ!'],
    ['Taxi gì mà quay đầu giữa đường!', 'Khách gọi, tao phải đón!'],
    ['Xe ba gác chở gì mà to thế?!', 'Chở tủ lạnh, không được à?!'],
    ['Xe lu đi chậm như rùa!', 'Xe lu mà chạy nhanh thì đường phẳng sao được!'],
    ['Mày đi xe đạp giữa đường!', 'Đường này có làn xe đạp đâu?!'],
    ['Container mà rẽ không xi nhan!', 'Xe tao dài, mày phải tự hiểu!'],
    ['Xe rác đổ hết ra đường rồi!', 'Tại mày đâm chứ ai!'],
    ['Xe trộn bê tông quay quay làm gì?!', 'Không quay thì bê tông đông!'],
    ['Grab mà chở ba người!', 'Khách là thượng đế!'],
    ['Đền cái gương chiếu hậu!', 'Gương mày đã nứt từ trước!'],
    ['Mày dừng đỗ không đúng chỗ!', 'Chỗ này không có biển cấm!'],
    ['Tao đang vội!', 'Ai mà chả vội!'],
    ['Mày nhìn cái vết xước này!', 'Vết đó là của năm ngoái!'],
    ['Đi chậm thôi chứ!', 'Đường thông thì tao đi nhanh!'],
    ['Mày quay đầu xe ẩu!', 'Tao xi nhan rồi mà!'],
    ['Xi nhan trái mà rẽ phải!', 'Tao quen tay thôi!'],
    ['Thôi hòa nhé?', 'Hòa cái gì, đền xe đây!'],
    ['Xe cẩu ai cho chạy làn này?!', 'Tao cẩu luôn xe mày bây giờ!'],
    ['Đường to thế mà đâm được!', 'Tại mày đi giữa đường!'],
  ],
};
export type Category = keyof typeof LINES;
export type PairCategory = keyof typeof PAIRS;
